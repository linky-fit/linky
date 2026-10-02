import type {
  LocalNostrMessage,
  UpdateLocalNostrMessage,
  UpdateLocalNostrReaction,
} from "../../types/appTypes";
import { asNonEmptyString, trimString } from "../../../utils/validation";
import { nowSeconds } from "../../../utils/time";
import { isSqliteTrueish } from "./messageRows";

export interface NostrMessageUpdatePayload {
  clientId?: string | null;
  content?: string;
  createdAtSec?: number;
  editedAtSec?: number | null;
  editedFromId?: string | null;
  id: string;
  isEdited?: string | null;
  localOnly?: string | null;
  originalContent?: string | null;
  pubkey?: string | null;
  replyToContent?: string | null;
  replyToId?: string | null;
  rootMessageId?: string | null;
  rumorId?: string | null;
  status?: "pending" | "sent";
  wrapId?: string;
}

export interface NostrReactionUpdatePayload {
  clientId?: string | null;
  emoji?: string;
  id: string;
  messageId?: string;
  reactorPubkey?: string;
  status?: "pending" | "sent";
  wrapId?: string;
}

/** The columns of a stored message an update compares against. */
export interface StoredMessageFields {
  readonly clientId: string | null;
  readonly content: string | null;
  readonly createdAtSec: number | null;
  readonly editedAtSec: number | null;
  readonly editedFromId: string | null;
  readonly isEdited: string | null;
  readonly localOnly: string | null;
  readonly originalContent: string | null;
  readonly pubkey: string | null;
  readonly replyToContent: string | null;
  readonly replyToId: string | null;
  readonly rootMessageId: string | null;
  readonly rumorId: string | null;
  readonly status: string | null;
  readonly wrapId: string | null;
}

/** The columns of a stored reaction an update compares against. */
export interface StoredReactionFields {
  readonly clientId: string | null;
  readonly emoji: string | null;
  readonly messageId: string | null;
  readonly reactorPubkey: string | null;
  readonly status: string | null;
  readonly wrapId: string | null;
}

const positiveInt = (value: unknown, fallback: number): number => {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) && Math.trunc(numeric) > 0
    ? Math.trunc(numeric)
    : fallback;
};
const status = (value: unknown): "pending" | "sent" =>
  value === "pending" ? "pending" : "sent";

const MESSAGE_TEXT_FIELDS = [
  "pubkey",
  "content",
  "clientId",
  "rumorId",
  "replyToId",
  "replyToContent",
  "rootMessageId",
  "editedFromId",
  "originalContent",
] satisfies readonly (keyof StoredMessageFields)[];
const MESSAGE_BOOLEAN_FIELDS = [
  "localOnly",
  "isEdited",
] satisfies readonly (keyof StoredMessageFields)[];
const REACTION_TEXT_FIELDS = [
  "messageId",
  "reactorPubkey",
  "emoji",
  "wrapId",
  "clientId",
] satisfies readonly (keyof StoredReactionFields)[];

/** The columns of `updates` that differ from the stored row; null when nothing changes. */
export const buildMessageUpdate = (
  id: string,
  updates: Parameters<UpdateLocalNostrMessage>[1],
  current: StoredMessageFields,
): NostrMessageUpdatePayload | null => {
  const payload: NostrMessageUpdatePayload = { id };
  const currentWrapId = asNonEmptyString(current.wrapId) ?? "";
  const currentStatus = status(current.status);
  if (updates.wrapId !== undefined) {
    const next = trimString(updates.wrapId);
    const nextStatus =
      updates.status !== undefined ? status(updates.status) : currentStatus;
    const keepSentWrap =
      currentWrapId &&
      !currentWrapId.startsWith("pending:") &&
      nextStatus === "sent";
    if (next && next !== currentWrapId && !keepSentWrap) payload.wrapId = next;
  }
  if (updates.status !== undefined && status(updates.status) !== currentStatus)
    payload.status = status(updates.status);
  for (const field of MESSAGE_TEXT_FIELDS) {
    if (updates[field] === undefined) continue;
    const next =
      field === "content" ? updates[field] : asNonEmptyString(updates[field]);
    if (next?.trim() && next !== (asNonEmptyString(current[field]) ?? ""))
      payload[field] = next;
  }
  for (const field of MESSAGE_BOOLEAN_FIELDS) {
    if (updates[field] && !isSqliteTrueish(current[field]))
      payload[field] = "1";
  }
  if (updates.createdAtSec !== undefined) {
    const next = positiveInt(updates.createdAtSec, nowSeconds());
    if (next !== (current.createdAtSec ?? 0)) payload.createdAtSec = next;
  }
  if (updates.editedAtSec) {
    const next = positiveInt(updates.editedAtSec, nowSeconds());
    if (next !== current.editedAtSec) payload.editedAtSec = next;
  }
  return Object.keys(payload).length > 1 ? payload : null;
};

/** The columns of `updates` that differ from the stored row; null when nothing changes. */
export const buildReactionUpdate = (
  id: string,
  updates: Parameters<UpdateLocalNostrReaction>[1],
  current: StoredReactionFields,
): NostrReactionUpdatePayload | null => {
  const payload: NostrReactionUpdatePayload = { id };
  for (const field of REACTION_TEXT_FIELDS) {
    if (updates[field] === undefined) continue;
    const next = asNonEmptyString(updates[field]);
    if (next && next !== asNonEmptyString(current[field]))
      payload[field] = next;
  }
  if (
    updates.status !== undefined &&
    status(updates.status) !== status(current.status)
  )
    payload.status = status(updates.status);
  return Object.keys(payload).length > 1 ? payload : null;
};

export const applyMessageUpdate = (
  message: LocalNostrMessage,
  payload: NostrMessageUpdatePayload,
): LocalNostrMessage => {
  const { clientId, pubkey, localOnly, isEdited, ...fields } = payload;
  const next: LocalNostrMessage = {
    ...message,
    ...fields,
    ...(pubkey !== undefined ? { pubkey: pubkey ?? "" } : {}),
    ...(localOnly !== undefined ? { localOnly: localOnly === "1" } : {}),
    ...(isEdited !== undefined ? { isEdited: isEdited === "1" } : {}),
  };
  if (clientId === null) delete next.clientId;
  else if (clientId !== undefined) next.clientId = clientId;
  return next;
};
