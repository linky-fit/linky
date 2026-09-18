import {
  directConversationIdFor,
  type ContactRow,
  type ConversationRow,
} from "@linky/linksync";

/** The direct conversation's state, read alongside the contact for display. */
export interface ContactChatState {
  archivedAtSec: number | null;
  chatLastSeenAtSec: number | null;
  chatPeerSeenSinceSec: number | null;
  chatPeerSeenAtSec: number | null;
}

export type ContactWithChatState = ContactRow & ContactChatState;

export const joinContactChatState = (
  contacts: ReadonlyArray<ContactRow>,
  conversations: ReadonlyArray<ConversationRow>,
): ContactWithChatState[] => {
  const conversationById = new Map(
    conversations.map((conversation) => [conversation.id, conversation]),
  );
  return contacts.map((contact) => {
    const conversation = conversationById.get(
      directConversationIdFor(contact.id),
    );
    return {
      ...contact,
      archivedAtSec: conversation?.archivedAtSec ?? null,
      chatLastSeenAtSec: conversation?.lastSeenAtSec ?? null,
      chatPeerSeenSinceSec: conversation?.peerSeenSinceSec ?? null,
      chatPeerSeenAtSec: conversation?.peerSeenAtSec ?? null,
    };
  });
};
