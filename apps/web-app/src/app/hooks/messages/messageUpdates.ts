import type * as Evolu from "@evolu/common";
import type {
  LocalNostrMessage,
  LocalNostrReaction,
  UpdateLocalNostrMessage,
  UpdateLocalNostrReaction,
} from "../../types/appTypes";
import { asNonEmptyString, trimString } from "../../../utils/validation";
import { nowSeconds } from "../../../utils/time";

export interface NostrMessageUpdatePayload {
  clientId?: string | null;
  contactId?: string;
  content?: string;
  createdAtSec?: number;
  editedAtSec?: number | null;
  editedFromId?: string | null;
  id: string;
  isDeleted?: typeof Evolu.sqliteTrue;
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
  isDeleted?: typeof Evolu.sqliteTrue;
  messageId?: string;
  reactorPubkey?: string;
  status?: "pending" | "sent";
  wrapId?: string;
}

export interface NostrMessageShadowState {
  clientId?: string | null;
  content?: string;
  createdAtSec?: number;
  editedAtSec?: number | null;
  editedFromId?: string | null;
  isEdited?: boolean;
  localOnly?: boolean;
  originalContent?: string | null;
  pubkey?: string | null;
  replyToContent?: string | null;
  replyToId?: string | null;
  rootMessageId?: string | null;
  rumorId?: string | null;
  status?: "pending" | "sent";
  wrapId?: string;
}

export interface NostrReactionShadowState {
  clientId?: string | null;
  emoji?: string | null;
  messageId?: string | null;
  reactorPubkey?: string | null;
  status?: "pending" | "sent";
  wrapId?: string;
}

const readShadowText = <T extends object>(
  shadow: T,
  key: keyof T,
  fallback: string | null,
): string | null =>
  Object.prototype.hasOwnProperty.call(shadow, key)
    ? asNonEmptyString(shadow[key])
    : fallback;

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
] satisfies readonly (keyof NostrMessageShadowState)[];
const MESSAGE_BOOLEAN_FIELDS = [
  "localOnly",
  "isEdited",
] satisfies readonly (keyof NostrMessageShadowState)[];
const REACTION_TEXT_FIELDS = [
  "messageId",
  "reactorPubkey",
  "emoji",
  "wrapId",
  "clientId",
] satisfies readonly (keyof NostrReactionShadowState)[];

export const buildMessageUpdate = (
  id: string,
  updates: Parameters<UpdateLocalNostrMessage>[1],
  current: LocalNostrMessage | undefined,
  shadow: NostrMessageShadowState,
): NostrMessageUpdatePayload | null => {
  const payload: NostrMessageUpdatePayload = { id };
  const currentWrapId =
    readShadowText(shadow, "wrapId", asNonEmptyString(current?.wrapId)) ?? "";
  const currentStatus = shadow.status ?? status(current?.status);
  if (updates.wrapId !== undefined) {
    const next = trimString(updates.wrapId);
    const nextStatus =
      updates.status !== undefined ? status(updates.status) : currentStatus;
    const keepSentWrap =
      currentWrapId &&
      !currentWrapId.startsWith("pending:") &&
      nextStatus === "sent";
    if (next && next !== currentWrapId && !keepSentWrap)
      payload.wrapId = shadow.wrapId = next;
  }
  if (updates.status !== undefined && status(updates.status) !== currentStatus)
    payload.status = shadow.status = status(updates.status);
  for (const field of MESSAGE_TEXT_FIELDS) {
    if (updates[field] === undefined) continue;
    const next =
      field === "content" ? updates[field] : asNonEmptyString(updates[field]);
    if (
      next?.trim() &&
      next !==
        (readShadowText(shadow, field, asNonEmptyString(current?.[field])) ??
          "")
    ) {
      payload[field] = next;
      shadow[field] = next;
    }
  }
  for (const field of MESSAGE_BOOLEAN_FIELDS) {
    if (updates[field] && !(shadow[field] ?? current?.[field])) {
      payload[field] = "1";
      shadow[field] = true;
    }
  }
  if (updates.createdAtSec !== undefined) {
    const next = positiveInt(updates.createdAtSec, nowSeconds());
    if (next !== (shadow.createdAtSec ?? current?.createdAtSec ?? 0))
      payload.createdAtSec = shadow.createdAtSec = next;
  }
  if (updates.editedAtSec) {
    const next = positiveInt(updates.editedAtSec, nowSeconds());
    const previous =
      shadow.editedAtSec !== undefined
        ? shadow.editedAtSec
        : (current?.editedAtSec ?? null);
    if (next !== previous) payload.editedAtSec = shadow.editedAtSec = next;
  }
  return Object.keys(payload).length > 1 ? payload : null;
};

export const buildReactionUpdate = (
  id: string,
  updates: Parameters<UpdateLocalNostrReaction>[1],
  current: LocalNostrReaction | undefined,
  shadow: NostrReactionShadowState,
): NostrReactionUpdatePayload | null => {
  const payload: NostrReactionUpdatePayload = { id };
  for (const field of REACTION_TEXT_FIELDS) {
    if (updates[field] === undefined) continue;
    const next = asNonEmptyString(updates[field]);
    if (
      next &&
      next !== readShadowText(shadow, field, asNonEmptyString(current?.[field]))
    ) {
      payload[field] = next;
      shadow[field] = next;
    }
  }
  const currentStatus = shadow.status ?? status(current?.status);
  if (updates.status !== undefined && status(updates.status) !== currentStatus)
    payload.status = shadow.status = status(updates.status);
  return Object.keys(payload).length > 1 ? payload : null;
};

export const applyMessageUpdate = (
  message: LocalNostrMessage,
  payload: NostrMessageUpdatePayload,
): LocalNostrMessage => {
  const { clientId, pubkey, localOnly, isEdited, ...fields } = payload;
  delete fields.isDeleted;
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
