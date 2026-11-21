import {
  directConversationIdFor,
  type ContactId,
  type ConversationId,
  type ConversationRecord,
  type MessageId,
  type MessageInsert,
  type MessagePatch,
  type MessageRecord,
  type ReactionId,
  type ReactionInsert,
  type ReactionPatch,
  type ReactionRecord,
  type UnknownSenderMessageInsert,
} from "@linky-fit/linksync";
import type { Pubkey } from "@linky-fit/linkstr";
import type {
  LocalNostrMessage,
  LocalNostrReaction,
  NewLocalNostrMessage,
  NewLocalNostrReaction,
} from "../../types/appTypes";
import {
  asNonEmptyString,
  makeLocalId,
  trimString,
} from "../../../utils/validation";
import type {
  NostrMessageUpdatePayload,
  NostrReactionUpdatePayload,
} from "./messageUpdates";

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const toText = (value: unknown): string =>
  typeof value === "string" ? value : "";

const toStatus = (value: unknown): "pending" | "sent" =>
  trimString(value) === "pending" ? "pending" : "sent";

/** A status column that has not synced yet stays unknown instead of `sent`. */
const syncedStatus = (
  value: unknown,
): { readonly status?: "pending" | "sent" } => {
  const status = trimString(value);
  return status === "pending" || status === "sent" ? { status } : {};
};

const toPositiveInt = (value: unknown, fallback: number): number => {
  const asNumber = Number(value ?? 0);
  if (!Number.isFinite(asNumber)) return fallback;
  const rounded = Math.trunc(asNumber);
  return rounded > 0 ? rounded : fallback;
};

const validPositiveInt = (value: number): number | undefined =>
  Number.isSafeInteger(value) && value > 0 ? value : undefined;

const nonEmptyText = (
  value: string | null | undefined,
  maxLength?: number,
): string | undefined => {
  if (typeof value !== "string" || value.length === 0) return undefined;
  if (maxLength !== undefined && value.length > maxLength) return undefined;
  return value;
};

/** Empty text is treated as absent: the columns are non-empty strings. */
const optionalText = (
  value: string | null | undefined,
  maxLength?: number,
): string | undefined =>
  asNonEmptyString(value) === null ? undefined : nonEmptyText(value, maxLength);

const textPatch = (
  value: string | null | undefined,
  maxLength?: number,
): string | null | undefined =>
  value === undefined
    ? undefined
    : value === null
      ? null
      : nonEmptyText(value, maxLength);

export const isSqliteTrueish = (value: unknown): boolean => {
  if (value === true || value === 1 || value === "1") return true;
  return trimString(value).toLowerCase() === "true";
};

const nowSec = (): number => Math.ceil(Date.now() / 1000);

/**
 * A message row names its conversation, the UI its contact. Direct chats
 * derive the conversation id from the contact id, so the contacts alone
 * recover the mapping when a conversation row lives in a forgotten shard.
 */
export const contactIdByConversationId = (
  conversations: ReadonlyArray<ConversationRecord>,
  contacts: ReadonlyArray<{ readonly id: ContactId }>,
): ReadonlyMap<string, string> => {
  const byConversation = new Map<string, string>();
  for (const contact of contacts)
    byConversation.set(directConversationIdFor(contact.id), contact.id);
  for (const conversation of conversations)
    if (conversation.contactId !== null)
      byConversation.set(conversation.id, conversation.contactId);
  return byConversation;
};

export const toLocalNostrMessage = (
  row: Omit<MessageRecord, "conversationId">,
  contactId: string | undefined,
): LocalNostrMessage | null => {
  const directionRaw = trimString(row.direction);
  const direction =
    directionRaw === "in" || directionRaw === "out" ? directionRaw : null;
  const content = toText(row.content);
  const wrapId = trimString(row.wrapId);
  if (!contactId || !direction || !content.trim() || !wrapId) return null;

  const clientId = asNonEmptyString(row.clientId);
  return {
    id: row.id,
    contactId,
    direction,
    content,
    wrapId,
    rumorId: asNonEmptyString(row.rumorId),
    pubkey: trimString(row.pubkey),
    createdAt: row.createdAt,
    createdAtSec: toPositiveInt(row.createdAtSec, nowSec()),
    ...syncedStatus(row.status),
    localOnly: isSqliteTrueish(row.localOnly),
    replyToId: asNonEmptyString(row.replyToId),
    replyToContent: asNonEmptyString(row.replyToContent),
    rootMessageId: asNonEmptyString(row.rootMessageId),
    editedAtSec:
      row.editedAtSec === null
        ? null
        : toPositiveInt(row.editedAtSec, nowSec()),
    editedFromId: asNonEmptyString(row.editedFromId),
    isEdited: isSqliteTrueish(row.isEdited),
    originalContent: asNonEmptyString(row.originalContent),
    deletedAtSec:
      row.deletedAtSec === null
        ? null
        : toPositiveInt(row.deletedAtSec, nowSec()),
    ...(clientId ? { clientId } : {}),
  };
};

export const toLocalNostrReaction = (
  row: ReactionRecord,
): LocalNostrReaction | null => {
  const messageId = trimString(row.messageId);
  const reactorPubkey = trimString(row.reactorPubkey);
  const emoji = toText(row.emoji).trim();
  const wrapId = trimString(row.wrapId);
  if (!messageId || !reactorPubkey || !emoji || !wrapId) return null;

  const clientId = asNonEmptyString(row.clientId);
  return {
    id: row.id,
    messageId,
    reactorPubkey,
    emoji,
    wrapId,
    createdAtSec: toPositiveInt(row.createdAtSec, nowSec()),
    status: toStatus(row.status),
    ...(clientId ? { clientId } : {}),
  };
};

/** The message as the UI keeps it, from what a caller handed over plus the id and wrap the row got. */
export const localMessageFrom = (
  message: NewLocalNostrMessage,
  id: string,
  wrapId: string,
): LocalNostrMessage => {
  const clientId = asNonEmptyString(message.clientId);
  return {
    id,
    contactId: trimString(message.contactId),
    direction: message.direction,
    content: toText(message.content),
    wrapId,
    rumorId: asNonEmptyString(message.rumorId),
    pubkey: trimString(message.pubkey),
    createdAtSec: toPositiveInt(message.createdAtSec, nowSec()),
    status: toStatus(message.status),
    localOnly: Boolean(message.localOnly),
    replyToId: asNonEmptyString(message.replyToId),
    replyToContent: asNonEmptyString(message.replyToContent),
    rootMessageId: asNonEmptyString(message.rootMessageId),
    editedAtSec: message.editedAtSec
      ? toPositiveInt(message.editedAtSec, nowSec())
      : null,
    editedFromId: asNonEmptyString(message.editedFromId),
    isEdited: Boolean(message.isEdited),
    originalContent: asNonEmptyString(message.originalContent),
    deletedAtSec: message.deletedAtSec
      ? toPositiveInt(message.deletedAtSec, nowSec())
      : null,
    ...(clientId ? { clientId } : {}),
  };
};

/** Messages kept in localStorage before Evolu, and the overlay for unsaved peers. */
export const normalizeLegacyLocalMessage = (
  row: Record<string, unknown>,
): LocalNostrMessage | null => {
  const contactId = trimString(row.contactId);
  const directionRaw = trimString(row.direction);
  const direction =
    directionRaw === "in" || directionRaw === "out" ? directionRaw : null;
  const content = toText(row.content);
  if (!contactId || !direction || !content.trim()) return null;

  const clientId = asNonEmptyString(row.clientId);
  return localMessageFrom(
    {
      contactId,
      direction,
      content,
      wrapId: trimString(row.wrapId),
      rumorId: asNonEmptyString(row.rumorId),
      pubkey: trimString(row.pubkey),
      createdAtSec: toPositiveInt(row.createdAtSec, nowSec()),
      status: toStatus(row.status),
      localOnly: Boolean(row.localOnly),
      replyToId: asNonEmptyString(row.replyToId),
      replyToContent: asNonEmptyString(row.replyToContent),
      rootMessageId: asNonEmptyString(row.rootMessageId),
      editedAtSec: row.editedAtSec
        ? toPositiveInt(row.editedAtSec, nowSec())
        : null,
      editedFromId: asNonEmptyString(row.editedFromId),
      isEdited: Boolean(row.isEdited),
      originalContent: asNonEmptyString(row.originalContent),
      ...(clientId ? { clientId } : {}),
    },
    trimString(row.id) || makeLocalId(),
    trimString(row.wrapId) || `legacy:${makeLocalId()}`,
  );
};

type MessageContent = Omit<MessageInsert, "id" | "conversationId">;

/** The whole message the UI hands over, as the columns every message table shares. */
const toMessageContent = (
  message: NewLocalNostrMessage,
  wrapIdText: string,
): MessageContent | null => {
  const directionRaw = trimString(message.direction);
  const direction =
    directionRaw === "in" || directionRaw === "out" ? directionRaw : null;
  const content = nonEmptyText(toText(message.content));
  if (!direction || !content?.trim()) return null;
  const wrapId = nonEmptyText(wrapIdText, 1000);
  const createdAtSec = validPositiveInt(
    toPositiveInt(message.createdAtSec, nowSec()),
  );
  if (!wrapId || !createdAtSec) return null;
  const editedAtSec = message.editedAtSec
    ? validPositiveInt(toPositiveInt(message.editedAtSec, createdAtSec))
    : undefined;
  const deletedAtSec = message.deletedAtSec
    ? validPositiveInt(toPositiveInt(message.deletedAtSec, createdAtSec))
    : undefined;

  const row: Mutable<MessageContent> = {
    direction,
    content,
    wrapId,
    createdAtSec,
    status: toStatus(message.status),
  };
  const rumorId = optionalText(message.rumorId, 1000);
  if (rumorId) row.rumorId = rumorId;
  const pubkey = optionalText(message.pubkey, 1000);
  if (pubkey) row.pubkey = pubkey;
  const clientId = optionalText(message.clientId, 1000);
  if (clientId) row.clientId = clientId;
  if (message.localOnly) row.localOnly = "1";
  const replyToId = optionalText(message.replyToId, 1000);
  if (replyToId) row.replyToId = replyToId;
  const replyToContent = optionalText(message.replyToContent);
  if (replyToContent) row.replyToContent = replyToContent;
  const rootMessageId = optionalText(message.rootMessageId, 1000);
  if (rootMessageId) row.rootMessageId = rootMessageId;
  if (editedAtSec) row.editedAtSec = editedAtSec;
  const editedFromId = optionalText(message.editedFromId, 1000);
  if (editedFromId) row.editedFromId = editedFromId;
  if (message.isEdited) row.isEdited = "1";
  const originalContent = optionalText(message.originalContent);
  if (originalContent) row.originalContent = originalContent;
  if (deletedAtSec) row.deletedAtSec = deletedAtSec;
  return row;
};

/** The whole message the UI hands over, as the row the repository accepts. */
export const toMessageWriteRow = (
  id: MessageId,
  conversationId: ConversationId,
  message: NewLocalNostrMessage,
  wrapIdText: string,
): MessageInsert | null => {
  const content = toMessageContent(message, wrapIdText);
  return content && { ...content, id, conversationId };
};

/** A message in a conversation with an unknown sender, as the row the repository accepts. */
export const toUnknownSenderWriteRow = (
  id: MessageId,
  peerPubkey: Pubkey,
  message: NewLocalNostrMessage,
  wrapIdText: string,
): UnknownSenderMessageInsert | null => {
  const content = toMessageContent(message, wrapIdText);
  const peer = nonEmptyText(peerPubkey, 1000);
  return content && peer ? { ...content, id, peerPubkey: peer } : null;
};

export const toReactionWriteRow = (
  id: ReactionId,
  conversationId: ConversationId,
  reaction: NewLocalNostrReaction,
  wrapIdText: string,
): ReactionInsert | null => {
  const messageId = optionalText(reaction.messageId, 1000);
  const reactorPubkey = optionalText(reaction.reactorPubkey, 1000);
  const emoji = optionalText(toText(reaction.emoji).trim(), 100);
  const wrapId = nonEmptyText(wrapIdText, 1000);
  const createdAtSec = validPositiveInt(
    toPositiveInt(reaction.createdAtSec, nowSec()),
  );
  if (!messageId || !reactorPubkey || !emoji || !wrapId || !createdAtSec)
    return null;
  const row: Mutable<ReactionInsert> = {
    id,
    conversationId,
    messageId,
    reactorPubkey,
    emoji,
    wrapId,
    createdAtSec,
    status: toStatus(reaction.status),
  };
  const clientId = optionalText(reaction.clientId, 1000);
  if (clientId) row.clientId = clientId;
  return row;
};

/** The columns an update payload names, validated; a value the column rejects is dropped. */
export const toMessagePatch = (
  payload: NostrMessageUpdatePayload,
): MessagePatch => {
  const patch: Mutable<MessagePatch> = {};
  const text1000 = [
    "clientId",
    "editedFromId",
    "pubkey",
    "replyToId",
    "rootMessageId",
    "rumorId",
  ] as const;
  for (const field of text1000) {
    const value = textPatch(payload[field], 1000);
    if (value !== undefined) patch[field] = value;
  }
  for (const field of ["originalContent", "replyToContent"] as const) {
    const value = textPatch(payload[field]);
    if (value !== undefined) patch[field] = value;
  }
  for (const field of ["isEdited", "localOnly", "status"] as const) {
    const value = textPatch(payload[field], 100);
    if (value !== undefined) patch[field] = value;
  }
  const content = optionalText(payload.content);
  if (content) patch.content = content;
  const wrapId = optionalText(payload.wrapId, 1000);
  if (wrapId) patch.wrapId = wrapId;
  if (payload.createdAtSec !== undefined) {
    const value = validPositiveInt(payload.createdAtSec);
    if (value) patch.createdAtSec = value;
  }
  if (payload.editedAtSec !== undefined) {
    patch.editedAtSec =
      payload.editedAtSec === null
        ? null
        : (validPositiveInt(payload.editedAtSec) ?? null);
  }
  return patch;
};

export const toReactionPatch = (
  payload: NostrReactionUpdatePayload,
): ReactionPatch => {
  const patch: Mutable<ReactionPatch> = {};
  const clientId = textPatch(payload.clientId, 1000);
  if (clientId !== undefined) patch.clientId = clientId;
  for (const field of ["messageId", "reactorPubkey", "wrapId"] as const) {
    const value = optionalText(payload[field], 1000);
    if (value) patch[field] = value;
  }
  const emoji = optionalText(payload.emoji, 100);
  if (emoji) patch.emoji = emoji;
  const status = optionalText(payload.status, 100);
  if (status) patch.status = status;
  return patch;
};
