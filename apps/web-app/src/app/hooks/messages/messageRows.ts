import {
  directConversationIdFor,
  NonEmptyString,
  NonEmptyString100,
  NonEmptyString1000,
  PositiveInt,
  type ContactId,
  type ConversationId,
  type ConversationRow,
  type LinkyDbSchema,
  type MessageId,
  type MessageRow,
  type Patch,
  type ReactionId,
  type ReactionRow,
  type WriteRow,
} from "@linky/linksync";
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

type MessageColumns = LinkyDbSchema["message"];
type ReactionColumns = LinkyDbSchema["reaction"];
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const toText = (value: unknown): string =>
  typeof value === "string" ? value : "";

const toStatus = (value: unknown): "pending" | "sent" =>
  trimString(value) === "pending" ? "pending" : "sent";

const toPositiveInt = (value: unknown, fallback: number): number => {
  const asNumber = Number(value ?? 0);
  if (!Number.isFinite(asNumber)) return fallback;
  const rounded = Math.trunc(asNumber);
  return rounded > 0 ? rounded : fallback;
};

const isSqliteTrueish = (value: unknown): boolean => {
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
  conversations: ReadonlyArray<ConversationRow>,
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
  row: MessageRow,
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
    createdAtSec: toPositiveInt(row.createdAtSec, nowSec()),
    status: toStatus(row.status),
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
    ...(clientId ? { clientId } : {}),
  };
};

export const toLocalNostrReaction = (
  row: ReactionRow,
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

interface Decoder<T> {
  readonly fromUnknown: (
    value: unknown,
  ) => { ok: true; value: T } | { ok: false };
}

const decode = <T>(type: Decoder<T>, value: unknown): T | undefined => {
  const result = type.fromUnknown(value);
  return result.ok ? result.value : undefined;
};

/** Empty text is treated as absent: the columns are non-empty strings. */
const optionalText = <T>(
  type: Decoder<T>,
  value: string | null | undefined,
): T | undefined =>
  asNonEmptyString(value) === null ? undefined : decode(type, value);

/** The whole message the UI hands over, as the row the repository accepts. */
export const toMessageWriteRow = (
  id: MessageId,
  conversationId: ConversationId,
  message: NewLocalNostrMessage,
  wrapIdText: string,
): WriteRow<MessageColumns> | null => {
  const directionRaw = trimString(message.direction);
  const direction =
    directionRaw === "in" || directionRaw === "out" ? directionRaw : null;
  const content = decode(NonEmptyString, toText(message.content));
  if (!direction || !content?.trim()) return null;
  const wrapId = decode(NonEmptyString1000, wrapIdText);
  const createdAtSec = decode(
    PositiveInt,
    toPositiveInt(message.createdAtSec, nowSec()),
  );
  if (!wrapId || !createdAtSec) return null;
  const editedAtSec = message.editedAtSec
    ? decode(PositiveInt, toPositiveInt(message.editedAtSec, createdAtSec))
    : undefined;

  const row: Mutable<WriteRow<MessageColumns>> = {
    id,
    conversationId,
    direction: NonEmptyString100.orThrow(direction),
    content,
    wrapId,
    createdAtSec,
    status: NonEmptyString100.orThrow(toStatus(message.status)),
  };
  const rumorId = optionalText(NonEmptyString1000, message.rumorId);
  if (rumorId) row.rumorId = rumorId;
  const pubkey = optionalText(NonEmptyString1000, message.pubkey);
  if (pubkey) row.pubkey = pubkey;
  const clientId = optionalText(NonEmptyString1000, message.clientId);
  if (clientId) row.clientId = clientId;
  if (message.localOnly) row.localOnly = NonEmptyString100.orThrow("1");
  const replyToId = optionalText(NonEmptyString1000, message.replyToId);
  if (replyToId) row.replyToId = replyToId;
  const replyToContent = optionalText(NonEmptyString, message.replyToContent);
  if (replyToContent) row.replyToContent = replyToContent;
  const rootMessageId = optionalText(NonEmptyString1000, message.rootMessageId);
  if (rootMessageId) row.rootMessageId = rootMessageId;
  if (editedAtSec) row.editedAtSec = editedAtSec;
  const editedFromId = optionalText(NonEmptyString1000, message.editedFromId);
  if (editedFromId) row.editedFromId = editedFromId;
  if (message.isEdited) row.isEdited = NonEmptyString100.orThrow("1");
  const originalContent = optionalText(NonEmptyString, message.originalContent);
  if (originalContent) row.originalContent = originalContent;
  return row;
};

export const toReactionWriteRow = (
  id: ReactionId,
  conversationId: ConversationId,
  reaction: NewLocalNostrReaction,
  wrapIdText: string,
): WriteRow<ReactionColumns> | null => {
  const messageId = optionalText(NonEmptyString1000, reaction.messageId);
  const reactorPubkey = optionalText(
    NonEmptyString1000,
    reaction.reactorPubkey,
  );
  const emoji = optionalText(NonEmptyString100, toText(reaction.emoji).trim());
  const wrapId = decode(NonEmptyString1000, wrapIdText);
  const createdAtSec = decode(
    PositiveInt,
    toPositiveInt(reaction.createdAtSec, nowSec()),
  );
  if (!messageId || !reactorPubkey || !emoji || !wrapId || !createdAtSec)
    return null;
  const row: Mutable<WriteRow<ReactionColumns>> = {
    id,
    conversationId,
    messageId,
    reactorPubkey,
    emoji,
    wrapId,
    createdAtSec,
    status: NonEmptyString100.orThrow(toStatus(reaction.status)),
  };
  const clientId = optionalText(NonEmptyString1000, reaction.clientId);
  if (clientId) row.clientId = clientId;
  return row;
};

const textPatch = <T>(
  type: Decoder<T>,
  value: string | null | undefined,
): T | null | undefined =>
  value === undefined ? undefined : value === null ? null : decode(type, value);

/** The columns an update payload names, decoded; a value the column rejects is dropped. */
export const toMessagePatch = (
  payload: NostrMessageUpdatePayload,
): Patch<MessageColumns> => {
  const patch: Mutable<Patch<MessageColumns>> = {};
  const text1000 = [
    "clientId",
    "editedFromId",
    "pubkey",
    "replyToId",
    "rootMessageId",
    "rumorId",
  ] as const;
  for (const field of text1000) {
    const value = textPatch(NonEmptyString1000, payload[field]);
    if (value !== undefined) patch[field] = value;
  }
  for (const field of ["originalContent", "replyToContent"] as const) {
    const value = textPatch(NonEmptyString, payload[field]);
    if (value !== undefined) patch[field] = value;
  }
  for (const field of ["isEdited", "localOnly", "status"] as const) {
    const value = textPatch(NonEmptyString100, payload[field]);
    if (value !== undefined) patch[field] = value;
  }
  const content = optionalText(NonEmptyString, payload.content);
  if (content) patch.content = content;
  const wrapId = optionalText(NonEmptyString1000, payload.wrapId);
  if (wrapId) patch.wrapId = wrapId;
  if (payload.createdAtSec !== undefined) {
    const value = decode(PositiveInt, payload.createdAtSec);
    if (value) patch.createdAtSec = value;
  }
  if (payload.editedAtSec !== undefined) {
    patch.editedAtSec =
      payload.editedAtSec === null
        ? null
        : (decode(PositiveInt, payload.editedAtSec) ?? null);
  }
  return patch;
};

export const toReactionPatch = (
  payload: NostrReactionUpdatePayload,
): Patch<ReactionColumns> => {
  const patch: Mutable<Patch<ReactionColumns>> = {};
  const clientId = textPatch(NonEmptyString1000, payload.clientId);
  if (clientId !== undefined) patch.clientId = clientId;
  for (const field of ["messageId", "reactorPubkey", "wrapId"] as const) {
    const value = optionalText(NonEmptyString1000, payload[field]);
    if (value) patch[field] = value;
  }
  const emoji = optionalText(NonEmptyString100, payload.emoji);
  if (emoji) patch.emoji = emoji;
  const status = optionalText(NonEmptyString100, payload.status);
  if (status) patch.status = status;
  return patch;
};
