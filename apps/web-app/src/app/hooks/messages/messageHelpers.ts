import type { LocalNostrMessage } from "../../types/appTypes";
import { trimString } from "../../../utils/validation";

export const getLocalNostrMessageRumorKey = (
  message: Pick<LocalNostrMessage, "contactId" | "direction" | "rumorId">,
): string => {
  const rumorId = trimString(message.rumorId);
  if (!rumorId) return "";

  const contactId = trimString(message.contactId);
  const direction = trimString(message.direction);
  if (!contactId || (direction !== "in" && direction !== "out")) return "";

  return `${contactId}|${direction}|${rumorId}`;
};

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

export const dedupeNostrMessagesByPriority = (
  input: readonly LocalNostrMessage[],
): LocalNostrMessage[] => {
  const rows = [...input];
  rows.sort((a, b) => a.createdAtSec - b.createdAtSec);

  const deduped: LocalNostrMessage[] = [];
  const indexByWrapId = new Map<string, number>();
  const indexByClientId = new Map<string, number>();
  const indexByRumorKey = new Map<string, number>();

  for (const message of rows) {
    const wrapId = trimString(message.wrapId);
    const clientId = trimString(message.clientId);
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
    if (existingIndex === undefined && clientId) {
      const byClient = indexByClientId.get(clientId);
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
      if (clientId) indexByClientId.set(clientId, nextIndex);
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
    deduped[existingIndex] = mergeMessageMetadata(
      nextMessage,
      alternateMessage,
    );
    const nextWrapId = trimString(nextMessage.wrapId);
    const nextClientId = trimString(nextMessage.clientId);
    const nextRumorKey = getLocalNostrMessageRumorKey(nextMessage);
    if (nextWrapId) indexByWrapId.set(nextWrapId, existingIndex);
    if (nextClientId) indexByClientId.set(nextClientId, existingIndex);
    if (nextRumorKey) indexByRumorKey.set(nextRumorKey, existingIndex);
  }

  deduped.sort((a, b) => a.createdAtSec - b.createdAtSec);
  return deduped;
};

export const dedupeChatMessages = (
  list: LocalNostrMessage[],
): LocalNostrMessage[] => {
  const seenWrapIds = new Set<string>();
  const seenClientIds = new Set<string>();
  const seenRumorKeys = new Set<string>();
  const seenFallbackKeys = new Set<string>();
  const deduped: LocalNostrMessage[] = [];

  for (const message of dedupeNostrMessagesByPriority(list)) {
    const wrapId = trimString(message.wrapId);
    if (wrapId) {
      if (seenWrapIds.has(wrapId)) continue;
      seenWrapIds.add(wrapId);
    }

    const clientId = trimString(message.clientId);
    if (clientId) {
      if (seenClientIds.has(clientId)) continue;
      seenClientIds.add(clientId);
    }

    const rumorKey = getLocalNostrMessageRumorKey(message);
    if (rumorKey) {
      if (seenRumorKeys.has(rumorKey)) continue;
      seenRumorKeys.add(rumorKey);
    }

    if (!wrapId && !clientId) {
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
