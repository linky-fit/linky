import type { LocalNostrMessage } from "../../types/appTypes";
import {
  carriesPayment,
  DELETED_MESSAGE_CONTENT,
  isDeletedMessage,
} from "../../lib/deletedMessage";
import { trimString } from "../../../utils/validation";

type ConversationScope = Pick<LocalNostrMessage, "contactId" | "direction">;

const conversationKey = (
  message: ConversationScope,
  id: string | null | undefined,
): string => {
  const value = trimString(id);
  if (!value) return "";

  const contactId = trimString(message.contactId);
  const direction = trimString(message.direction);
  if (!contactId || (direction !== "in" && direction !== "out")) return "";

  return `${contactId}|${direction}|${value}`;
};

export const getLocalNostrMessageRumorKey = (
  message: ConversationScope & Pick<LocalNostrMessage, "rumorId">,
): string => conversationKey(message, message.rumorId);

/** Senders pick client ids, so one is unique only per conversation and direction. */
export const getLocalNostrMessageClientKey = (
  message: ConversationScope & Pick<LocalNostrMessage, "clientId">,
): string => conversationKey(message, message.clientId);

const pickPreferredMessage = (
  current: LocalNostrMessage,
  candidate: LocalNostrMessage,
): LocalNostrMessage => {
  const score = (message: LocalNostrMessage): number => {
    const hasWrap = trimString(message.wrapId) ? 4 : 0;
    const hasClient = trimString(message.clientId) ? 2 : 0;
    const hasRumor = getLocalNostrMessageRumorKey(message) ? 1 : 0;
    const sent = (message.status ?? "sent") === "sent" ? 1 : 0;
    return hasWrap + hasClient + hasRumor + sent;
  };

  const currentScore = score(current);
  const candidateScore = score(candidate);
  if (candidateScore > currentScore) return candidate;
  if (candidateScore < currentScore) return current;

  return candidate.createdAtSec >= current.createdAtSec ? candidate : current;
};

const preferText = (
  primary: string | null | undefined,
  fallback: string | null | undefined,
): string | null | undefined => {
  const primaryText = trimString(primary);
  if (primaryText) return primaryText;

  const fallbackText = trimString(fallback);
  if (fallbackText) return fallbackText;

  if (primary === null || fallback === null) return null;
  return undefined;
};

const mergeMessageMetadata = (
  preferred: LocalNostrMessage,
  alternate: LocalNostrMessage,
): LocalNostrMessage => {
  const mergedClientId = preferText(preferred.clientId, alternate.clientId);
  const mergedRumorId = preferText(preferred.rumorId, alternate.rumorId);
  const mergedPubkey = preferText(preferred.pubkey, alternate.pubkey);
  const mergedReplyToId = preferText(preferred.replyToId, alternate.replyToId);
  const mergedReplyToContent = preferText(
    preferred.replyToContent,
    alternate.replyToContent,
  );
  const mergedRootMessageId = preferText(
    preferred.rootMessageId,
    alternate.rootMessageId,
  );
  const mergedEditedFromId = preferText(
    preferred.editedFromId,
    alternate.editedFromId,
  );
  const mergedOriginalContent = preferText(
    preferred.originalContent,
    alternate.originalContent,
  );
  const mergedEditedAtSec =
    preferred.editedAtSec ?? alternate.editedAtSec ?? null;
  const mergedIsEdited =
    preferred.isEdited === true || alternate.isEdited === true
      ? true
      : (preferred.isEdited ?? alternate.isEdited);
  const mergedLocalOnly =
    preferred.localOnly === true || alternate.localOnly === true
      ? true
      : (preferred.localOnly ?? alternate.localOnly);

  return {
    ...preferred,
    rumorId: mergedRumorId ?? null,
    pubkey: mergedPubkey ?? preferred.pubkey,
    editedAtSec: mergedEditedAtSec,
    ...(mergedClientId ? { clientId: mergedClientId } : {}),
    ...(mergedIsEdited !== undefined ? { isEdited: mergedIsEdited } : {}),
    ...(mergedLocalOnly !== undefined ? { localOnly: mergedLocalOnly } : {}),
    ...(mergedReplyToId ? { replyToId: mergedReplyToId } : {}),
    ...(mergedReplyToContent ? { replyToContent: mergedReplyToContent } : {}),
    ...(mergedRootMessageId ? { rootMessageId: mergedRootMessageId } : {}),
    ...(mergedEditedFromId ? { editedFromId: mergedEditedFromId } : {}),
    ...(mergedOriginalContent
      ? { originalContent: mergedOriginalContent }
      : {}),
  };
};

const compareText = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

/**
 * Oldest first. Rumors carry whole seconds, so messages of one second follow
 * the order their rows were stored in, which for the sender is send order.
 */
const compareMessagesOldestFirst = (
  a: LocalNostrMessage,
  b: LocalNostrMessage,
): number =>
  a.createdAtSec - b.createdAtSec ||
  compareText(a.storedAt ?? "", b.storedAt ?? "") ||
  compareText(a.id, b.id);

export const dedupeNostrMessagesByPriority = (
  input: readonly LocalNostrMessage[],
): LocalNostrMessage[] => {
  const rows = [...input];
  rows.sort(compareMessagesOldestFirst);

  const deduped: LocalNostrMessage[] = [];
  const indexByWrapId = new Map<string, number>();
  const indexByClientKey = new Map<string, number>();
  const indexByRumorKey = new Map<string, number>();

  for (const message of rows) {
    const wrapId = trimString(message.wrapId);
    const clientKey = getLocalNostrMessageClientKey(message);
    const rumorKey = getLocalNostrMessageRumorKey(message);

    let existingIndex: number | undefined;
    let matchedBy: "wrap" | "client" | "rumor" | null = null;
    if (wrapId) {
      const byWrap = indexByWrapId.get(wrapId);
      if (byWrap !== undefined) {
        existingIndex = byWrap;
        matchedBy = "wrap";
      }
    }
    if (existingIndex === undefined && clientKey) {
      const byClient = indexByClientKey.get(clientKey);
      if (byClient !== undefined) {
        existingIndex = byClient;
        matchedBy = "client";
      }
    }
    if (existingIndex === undefined && rumorKey) {
      const byRumor = indexByRumorKey.get(rumorKey);
      if (byRumor !== undefined) {
        existingIndex = byRumor;
        matchedBy = "rumor";
      }
    }

    if (existingIndex === undefined) {
      const nextIndex = deduped.push(message) - 1;
      if (wrapId) indexByWrapId.set(wrapId, nextIndex);
      if (clientKey) indexByClientKey.set(clientKey, nextIndex);
      if (rumorKey) indexByRumorKey.set(rumorKey, nextIndex);
      continue;
    }

    const current = deduped[existingIndex];
    const currentWrapId = trimString(current.wrapId);
    const candidateWrapId = trimString(message.wrapId);
    const currentClientId = trimString(current.clientId);
    const candidateClientId = trimString(message.clientId);

    let nextMessage = pickPreferredMessage(current, message);
    if (matchedBy === "client") {
      if (
        currentWrapId &&
        candidateWrapId &&
        currentWrapId !== candidateWrapId
      ) {
        nextMessage = current;
      }
    } else if (matchedBy === "rumor") {
      if (
        currentWrapId &&
        candidateWrapId &&
        currentWrapId !== candidateWrapId
      ) {
        nextMessage = current;
      } else if (
        currentClientId &&
        candidateClientId &&
        currentClientId !== candidateClientId
      ) {
        nextMessage = current;
      }
    }

    const alternateMessage = nextMessage === current ? message : current;
    deduped[existingIndex] = mergeDeletion(
      mergeMessageMetadata(nextMessage, alternateMessage),
      current,
      message,
    );
    const nextWrapId = trimString(nextMessage.wrapId);
    const nextClientKey = getLocalNostrMessageClientKey(nextMessage);
    const nextRumorKey = getLocalNostrMessageRumorKey(nextMessage);
    if (nextWrapId) indexByWrapId.set(nextWrapId, existingIndex);
    if (nextClientKey) indexByClientKey.set(nextClientKey, existingIndex);
    if (nextRumorKey) indexByRumorKey.set(nextRumorKey, existingIndex);
    // A later row naming the dropped copy's rumor id, like a deletion, still finds the message.
    const droppedRumorKey = getLocalNostrMessageRumorKey(alternateMessage);
    if (droppedRumorKey) indexByRumorKey.set(droppedRumorKey, existingIndex);
  }

  deduped.sort(compareMessagesOldestFirst);
  return applyDeletions(deduped);
};

const asDeleted = (
  message: LocalNostrMessage,
  deletedAtSec: number,
): LocalNostrMessage => ({
  ...message,
  content: DELETED_MESSAGE_CONTENT,
  deletedAtSec,
  originalContent: null,
  replyToContent: null,
});

/** A deletion of either copy deletes the merged message, unless the other copy carries a payment. */
const mergeDeletion = (
  merged: LocalNostrMessage,
  a: LocalNostrMessage,
  b: LocalNostrMessage,
): LocalNostrMessage => {
  const deleted = isDeletedMessage(a) ? a : isDeletedMessage(b) ? b : null;
  if (!deleted) return merged;
  const other = deleted === a ? b : a;
  if (!isDeletedMessage(other) && carriesPayment(other.content))
    return mergeMessageMetadata(other, deleted);
  return asDeleted(merged, deleted.deletedAtSec ?? 0);
};

const conversationRumorKey = (message: LocalNostrMessage): string => {
  const contactId = trimString(message.contactId);
  const rumorId = trimString(message.rumorId);
  return contactId && rumorId ? `${contactId}|${rumorId}` : "";
};

/**
 * A peer's deletion can land on a device before the deleted row syncs to it,
 * leaving an incoming placeholder beside the own message it names. Every row
 * of a conversation under a deleted rumor id shows as one deleted message, at
 * the first row's place, unless a row under it carries a payment: then the
 * deletion is dropped.
 */
const applyDeletions = (messages: LocalNostrMessage[]): LocalNostrMessage[] => {
  const deletedAtByKey = new Map<string, number>();
  for (const message of messages) {
    const key = conversationRumorKey(message);
    if (key && isDeletedMessage(message))
      deletedAtByKey.set(key, message.deletedAtSec ?? 0);
  }
  if (deletedAtByKey.size === 0) return messages;

  const protectedKeys = new Set<string>();
  for (const message of messages) {
    const key = conversationRumorKey(message);
    if (
      deletedAtByKey.has(key) &&
      !isDeletedMessage(message) &&
      carriesPayment(message.content)
    )
      protectedKeys.add(key);
  }

  const shown = new Set<string>();
  return messages.flatMap((message) => {
    const key = conversationRumorKey(message);
    const deletedAtSec = deletedAtByKey.get(key);
    if (deletedAtSec === undefined) return [message];
    if (protectedKeys.has(key))
      return isDeletedMessage(message) ? [] : [message];
    if (shown.has(key)) return [];
    shown.add(key);
    return [
      isDeletedMessage(message) ? message : asDeleted(message, deletedAtSec),
    ];
  });
};

export const dedupeChatMessages = (
  list: LocalNostrMessage[],
): LocalNostrMessage[] => {
  const seenWrapIds = new Set<string>();
  const seenClientKeys = new Set<string>();
  const seenRumorKeys = new Set<string>();
  const seenFallbackKeys = new Set<string>();
  const deduped: LocalNostrMessage[] = [];

  for (const message of dedupeNostrMessagesByPriority(list)) {
    const wrapId = trimString(message.wrapId);
    if (wrapId) {
      if (seenWrapIds.has(wrapId)) continue;
      seenWrapIds.add(wrapId);
    }

    const clientKey = getLocalNostrMessageClientKey(message);
    if (clientKey) {
      if (seenClientKeys.has(clientKey)) continue;
      seenClientKeys.add(clientKey);
    }

    const rumorKey = getLocalNostrMessageRumorKey(message);
    if (rumorKey) {
      if (seenRumorKeys.has(rumorKey)) continue;
      seenRumorKeys.add(rumorKey);
    }

    if (!wrapId && !clientKey) {
      const content = trimString(message.content);
      const createdAtSec = message.createdAtSec || 0;
      const direction = trimString(message.direction);
      const fallbackKey = `${direction}|${createdAtSec}|${content}`;

      if (content && createdAtSec > 0) {
        if (seenFallbackKeys.has(fallbackKey)) continue;
        seenFallbackKeys.add(fallbackKey);
      }
    }

    deduped.push(message);
  }

  const visibleByBaseKey = new Map<string, LocalNostrMessage>();
  for (const message of deduped) {
    const contactId = trimString(message.contactId);
    const direction = trimString(message.direction);
    const baseRumorId =
      trimString(message.editedFromId) || trimString(message.rumorId);
    if (!contactId || !baseRumorId) continue;
    if (direction !== "in" && direction !== "out") continue;

    const baseKey = `${contactId}|${direction}|${baseRumorId}`;
    const current = visibleByBaseKey.get(baseKey);
    if (!current) {
      visibleByBaseKey.set(baseKey, message);
      continue;
    }

    const currentEditedWeight =
      trimString(current.editedFromId) || current.isEdited ? 1 : 0;
    const candidateEditedWeight =
      trimString(message.editedFromId) || message.isEdited ? 1 : 0;

    if (candidateEditedWeight > currentEditedWeight) {
      visibleByBaseKey.set(baseKey, message);
      continue;
    }
    if (candidateEditedWeight < currentEditedWeight) continue;

    const currentEditedAt = (current.editedAtSec ?? 0) || 0;
    const candidateEditedAt = (message.editedAtSec ?? 0) || 0;
    if (candidateEditedAt > currentEditedAt) {
      visibleByBaseKey.set(baseKey, message);
      continue;
    }
    if (candidateEditedAt < currentEditedAt) continue;

    if (message.createdAtSec >= current.createdAtSec) {
      visibleByBaseKey.set(baseKey, message);
    }
  }

  const collapsed = deduped.filter((message) => {
    const contactId = trimString(message.contactId);
    const direction = trimString(message.direction);
    const baseRumorId =
      trimString(message.editedFromId) || trimString(message.rumorId);
    if (!contactId || !baseRumorId) return true;
    if (direction !== "in" && direction !== "out") return true;

    const baseKey = `${contactId}|${direction}|${baseRumorId}`;
    return visibleByBaseKey.get(baseKey)?.id === message.id;
  });

  return collapsed;
};
