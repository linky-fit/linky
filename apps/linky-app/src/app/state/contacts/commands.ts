import { decodeNpub } from "@linky-fit/linkstr";
import {
  createId,
  directConversationIdFor,
  NonEmptyString1000,
  PositiveInt,
  type ContactId,
  type ContactsRepository,
  type ConversationsRepository,
} from "@linky-fit/linksync";
import { Effect } from "effect";
import { AsyncResult, Atom } from "effect/reactivity";
import { deriveDefaultProfile } from "../../../derivedProfile";
import { reportAppLog } from "../../../devtools/inspector/appLog";
import { isDeletedContact } from "../../../utils/contactName";
import { formatShortNpub } from "../../../utils/formatting";
import { normalizeNpubIdentifier } from "../../../utils/nostrNpub";
import { buildUnknownContactId } from "../../hooks/messages/contactIdentity";
import { runWrite, type WriteOutcome } from "../../lib/storeWrite";
import {
  messagesCommandsAtom,
  type MessagesCommands,
} from "../messages/commands";
import {
  contactsRepositoryAtom,
  conversationsRepositoryAtom,
} from "../session/store";
import { displayPrefsAtom } from "../shell/displayPrefs";
import type { ContactRowLike } from "../../types/appTypes";
import { unknownNamesAtom } from "./chatContacts";
import { contactsAtom } from "./readModel";

export interface ContactsCommands {
  /**
   * Deletes the contact: the row and its messages stay, `archivedAtSec` (a
   * frozen column name) records the deletion and the chat is marked read, so
   * only an incoming message newer than that brings the contact back.
   */
  readonly deleteContact: (id: ContactId) => Promise<WriteOutcome>;
  /** Restores a deleted contact and takes over what its npub sent while unknown. */
  readonly restoreContact: (id: ContactId) => Promise<WriteOutcome>;
}

const makeContactsCommands = ({
  contacts,
  conversations,
  messages,
}: {
  readonly contacts: ContactsRepository;
  readonly conversations: ConversationsRepository;
  readonly messages: MessagesCommands;
}): ContactsCommands => ({
  deleteContact: async (id) => {
    const deletedAtSec = PositiveInt.orThrow(Math.ceil(Date.now() / 1e3));
    const outcome = await runWrite(
      Effect.andThen(
        contacts.archive(id, deletedAtSec),
        Effect.flatMap(conversations.ensureDirect(id), (chat) =>
          conversations.markSeen(chat.id, deletedAtSec),
        ),
      ),
    );
    if (outcome.ok)
      reportAppLog({
        tag: "contacts.deleted",
        summary: "Deleted a contact",
        links: { contact: id, conversation: directConversationIdFor(id) },
        payload: { deletedAtSec },
      });
    return outcome;
  },
  restoreContact: async (id) => {
    const outcome = await runWrite(contacts.unarchive(id));
    if (!outcome.ok) return outcome;
    reportAppLog({
      tag: "contacts.restored",
      summary: "Restored a deleted contact",
      links: { contact: id, conversation: directConversationIdFor(id) },
      payload: { contactId: id },
    });
    const unknownContactId = await Effect.runPromise(
      contacts.byId(id).pipe(
        Effect.map((contact) => {
          const npub = normalizeNpubIdentifier(contact?.npub ?? "");
          return npub ? buildUnknownContactId(decodeNpub(npub)) : null;
        }),
        // The contact is restored either way; only the message move is skipped.
        Effect.catchCause((cause) =>
          Effect.sync(() => {
            console.warn(
              "[linky][contacts] restored contact read failed",
              cause,
            );
            return null;
          }),
        ),
      ),
    );
    if (unknownContactId)
      void messages.reassignContactMessages(unknownContactId, id);
    return outcome;
  },
});

/** Contact writes over the session's store; fails while signed out. */
export const contactsCommandsAtom = Atom.readable((get) =>
  AsyncResult.map(
    AsyncResult.all({
      contacts: get(contactsRepositoryAtom),
      conversations: get(conversationsRepositoryAtom),
      messages: get(messagesCommandsAtom),
    }),
    makeContactsCommands,
  ),
);

export interface SavedNpubContact {
  readonly contact: ContactRowLike & { readonly id: ContactId };
  readonly created: boolean;
  readonly npub: string;
}

/**
 * Saves a Nostr peer as a contact and answers synchronously with the new id;
 * `onWriteFailed` hears of a row that did not store.
 */
export type SaveNpubContact = (
  rawNpub: string,
  onWriteFailed: (error: string) => void,
) => SavedNpubContact | null;

/**
 * The row is written in the background; the pending entry keeps a second
 * save of the same npub from inserting twice before the row is read back.
 */
export const saveNpubContactAtom = Atom.keepAlive(
  Atom.readable((get) =>
    AsyncResult.map(
      AsyncResult.all({
        contactsRepository: get(contactsRepositoryAtom),
        commands: get(contactsCommandsAtom),
      }),
      ({ commands, contactsRepository }): SaveNpubContact => {
        const pending = new Map<string, SavedNpubContact>();
        get.subscribe(contactsAtom, (contacts) => {
          for (const contact of contacts) {
            const npub = normalizeNpubIdentifier(contact.npub ?? "");
            if (npub) pending.delete(npub);
          }
        });
        return (rawNpub, onWriteFailed) => {
          const npub = normalizeNpubIdentifier(rawNpub);
          if (!npub) return null;
          const existing = get.registry
            .get(contactsAtom)
            .find(
              (contact) => normalizeNpubIdentifier(contact.npub ?? "") === npub,
            );
          if (existing) {
            // A deleted contact comes back instead of being saved twice.
            if (isDeletedContact(existing))
              void commands.restoreContact(existing.id);
            return { contact: existing, created: false, npub };
          }
          const pendingContact = pending.get(npub);
          if (pendingContact) return { ...pendingContact, created: false };
          const bestName =
            get.registry.get(unknownNamesAtom)[npub] ??
            deriveDefaultProfile(npub, get.registry.get(displayPrefsAtom).lang)
              .name;
          const row = {
            id: createId<"Contact">(),
            name: NonEmptyString1000.orThrow(
              (bestName ?? "").trim() || formatShortNpub(npub),
            ),
            npub: NonEmptyString1000.orThrow(npub),
          };
          const saved = { contact: row, created: true, npub };
          pending.set(npub, saved);
          void runWrite(contactsRepository.insert(row)).then((outcome) => {
            if (outcome.ok) return;
            pending.delete(npub);
            onWriteFailed(outcome.error);
          });
          reportAppLog({
            tag: "contacts.npubSaved",
            summary: "Saved a Nostr contact",
            links: { contact: row.id },
            payload: { npub },
          });
          return saved;
        };
      },
    ),
  ),
);
