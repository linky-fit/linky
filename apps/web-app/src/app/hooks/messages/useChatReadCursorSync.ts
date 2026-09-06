import { writeContact } from "../../lib/writeContact";
import type { OwnerId } from "@evolu/common";
import React from "react";
import type { ContactId } from "../../../evolu";
import {
  resolveChatLastSeenAdvance,
  summarizeConversationReadTimes,
} from "../../lib/chatUnread";
import { resolveContactRowOwnerLane } from "../../lib/contactOwnerLane";
import type {
  LocalNostrMessage,
  RouteWithOptionalId,
} from "../../types/appTypes";

type EvoluUpdate = ReturnType<
  typeof import("../../../evolu").useEvolu
>["update"];

interface ChatReadCursorContact {
  chatLastSeenAtSec?: number | null;
  id: ContactId;
}

interface UseChatReadCursorSyncParams {
  chatMessages: readonly LocalNostrMessage[];
  contactsOwnerId: OwnerId | null;
  contactsVisibleOwnerIds: readonly OwnerId[];
  documentVisible: boolean;
  route: RouteWithOptionalId;
  selectedContact: ChatReadCursorContact | null;
  update: EvoluUpdate;
}

// Advances the persistent per-conversation read cursor while a chat is open.
// Writes are bounded: nothing is written unless the conversation is unread and
// the newest displayed message is newer than the stored cursor, because
// contact owner lanes rotate on write count.
export const useChatReadCursorSync = ({
  chatMessages,
  contactsOwnerId,
  contactsVisibleOwnerIds,
  documentVisible,
  route,
  selectedContact,
  update,
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
    if (target === null) return;

    const ownerId =
      resolveContactRowOwnerLane(selectedContact, contactsVisibleOwnerIds) ??
      contactsOwnerId;
    const payload = { id: selectedContact.id, chatLastSeenAtSec: target };
    const result = writeContact(update, payload, ownerId);
    if (result.ok) {
      lastWrittenAtSecByContactIdRef.current.set(contactId, target);
    }
  }, [
    chatMessages,
    contactsOwnerId,
    contactsVisibleOwnerIds,
    documentVisible,
    route,
    selectedContact,
    update,
  ]);
};
