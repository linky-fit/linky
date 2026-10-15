// Migration bridge, stays until no supported version archives on the conversation; removal gate in app/migrations/AGENTS.md
//
// The archive state moved from the conversation (messages scope, of which a
// new device sees only the newest shards) to the contact (never forgotten).
// Each hydrated device copies the archive of every conversation it sees onto
// its contact while the contact has none, and keeps doing so for archives
// older app versions still write on the conversation. An unarchive clears
// both, so an old conversation copy never undoes it.

import type {
  ContactId,
  ContactRow,
  ConversationRow,
  PositiveInt,
} from "@linky-fit/linksync";

export interface ArchiveCopy {
  readonly contactId: ContactId;
  readonly conversationId: ConversationRow["id"];
  readonly archivedAtSec: PositiveInt;
}

export const archivesToCopy = (
  contacts: ReadonlyArray<ContactRow>,
  conversations: ReadonlyArray<ConversationRow>,
): ReadonlyArray<ArchiveCopy> => {
  const contactById = new Map(contacts.map((contact) => [contact.id, contact]));
  return conversations.flatMap((conversation) => {
    const { archivedAtSec, contactId } = conversation;
    const contact = contactId === null ? undefined : contactById.get(contactId);
    if (archivedAtSec === null || contact === undefined) return [];
    if (contact.archivedAtSec !== null) return [];
    return [
      { contactId: contact.id, conversationId: conversation.id, archivedAtSec },
    ];
  });
};
