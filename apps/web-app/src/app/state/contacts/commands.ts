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
  /** Archives the contact and marks its chat read; a newer incoming message restores it. */
  readonly archiveContact: (id: ContactId) => Promise<WriteOutcome>;
  /** Restores an archived contact and takes over what its npub sent while unknown. */
  readonly unarchiveContact: (id: ContactId) => Promise<WriteOutcome>;
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
  archiveContact: async (id) => {
    const archivedAtSec = PositiveInt.orThrow(Math.ceil(Date.now() / 1e3));
    const outcome = await runWrite(
      Effect.andThen(
        contacts.archive(id, archivedAtSec),
        Effect.flatMap(conversations.ensureDirect(id), (chat) =>
          conversations.markSeen(chat.id, archivedAtSec),
        ),
      ),
    );
    if (outcome.ok)
      reportAppLog({
        tag: "conversations.archived",
        summary: "Archived a contact's conversation",
        links: { contact: id, conversation: directConversationIdFor(id) },
        payload: { archivedAtSec },
      });
    return outcome;
  },
  unarchiveContact: async (id) => {
    const outcome = await runWrite(contacts.unarchive(id));
    if (!outcome.ok) return outcome;
    reportAppLog({
      tag: "conversations.unarchived",
      summary: "Restored a contact's conversation from the archive",
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
              "[linky][contacts] unarchived contact read failed",
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
      get(contactsRepositoryAtom),
      (contactsRepository): SaveNpubContact => {
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
          if (existing) return { contact: existing, created: false, npub };
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
