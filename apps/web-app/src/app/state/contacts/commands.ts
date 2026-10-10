import { decodeNpub } from "@linky-fit/linkstr";
import {
  directConversationIdFor,
  PositiveInt,
  type ContactId,
  type ContactsRepository,
  type ConversationsRepository,
} from "@linky-fit/linksync";
import { Effect } from "effect";
import { AsyncResult, Atom } from "effect/reactivity";
import { reportAppLog } from "../../../devtools/inspector/appLog";
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
