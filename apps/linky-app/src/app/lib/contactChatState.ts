import {
  directConversationIdFor,
  type ContactRecord,
  type ConversationRecord,
} from "@linky-fit/linksync";

/** The direct conversation's read cursors, read alongside the contact for display. */
export interface ContactChatState {
  chatLastSeenAtSec: number | null;
  chatPeerSeenSinceSec: number | null;
  chatPeerSeenAtSec: number | null;
}

export type ContactWithChatState = ContactRecord & ContactChatState;

export const joinContactChatState = (
  contacts: ReadonlyArray<ContactRecord>,
  conversations: ReadonlyArray<ConversationRecord>,
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
      chatLastSeenAtSec: conversation?.lastSeenAtSec ?? null,
      chatPeerSeenSinceSec: conversation?.peerSeenSinceSec ?? null,
      chatPeerSeenAtSec: conversation?.peerSeenAtSec ?? null,
    };
  });
};
