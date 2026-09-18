import { PositiveInt, type ConversationsRepository } from "@linky/linksync";
import { Effect } from "effect";
import React from "react";
import type { ContactId } from "../../../evolu";
import {
  resolveChatLastSeenAdvance,
  summarizeConversationReadTimes,
} from "../../lib/chatUnread";
import { runWrite } from "../../lib/storeWrite";
import type {
  LocalNostrMessage,
  RouteWithOptionalId,
} from "../../types/appTypes";

interface ChatReadCursorContact {
  chatLastSeenAtSec?: number | null;
  id: ContactId;
}

interface UseChatReadCursorSyncParams {
  chatMessages: readonly LocalNostrMessage[];
  conversations: Pick<ConversationsRepository, "ensureDirect" | "markSeen">;
  documentVisible: boolean;
  route: RouteWithOptionalId;
  selectedContact: ChatReadCursorContact | null;
}

// Advances the conversation's read cursor while its chat is open. Nothing is
// written unless the conversation is unread and the newest displayed message
// is newer than the stored cursor; `markSeen` itself never moves backwards.
export const useChatReadCursorSync = ({
  chatMessages,
  conversations,
  documentVisible,
  route,
  selectedContact,
}: UseChatReadCursorSyncParams): void => {
  const lastWrittenAtSecByContactIdRef = React.useRef(
    new Map<string, number>(),
  );

  React.useEffect(() => {
    // A chat open in a background tab does not count as read.
    if (!documentVisible) return;
    if (route.kind !== "chat" || !selectedContact) return;
    const contactId = selectedContact.id.trim();
    if (!contactId || contactId !== (route.id ?? "").trim()) return;

    const storedAtSec = selectedContact.chatLastSeenAtSec ?? 0;
    const lastSeenAtSec = Math.max(
      Number.isFinite(storedAtSec) && storedAtSec > 0 ? storedAtSec : 0,
      lastWrittenAtSecByContactIdRef.current.get(contactId) ?? 0,
    );

    const target = resolveChatLastSeenAdvance(
      summarizeConversationReadTimes(chatMessages),
      lastSeenAtSec > 0 ? lastSeenAtSec : null,
    );
    const atSec = target === null ? null : PositiveInt.from(target);
    if (!atSec?.ok) return;

    lastWrittenAtSecByContactIdRef.current.set(contactId, atSec.value);
    void runWrite(
      Effect.flatMap(conversations.ensureDirect(selectedContact.id), (chat) =>
        conversations.markSeen(chat.id, atSec.value),
      ),
    ).then((outcome) => {
      if (outcome.ok) return;
      lastWrittenAtSecByContactIdRef.current.delete(contactId);
      console.warn("[linky][conversations] read cursor write failed", outcome);
    });
  }, [chatMessages, conversations, documentVisible, route, selectedContact]);
};
