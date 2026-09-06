import type {
  ChatMessageReceived,
  MessageBody,
  OwnChatMessageConfirmed,
} from "@linky/linkstr";
import { serializePrivateImageMessage } from "../../lib/privateImageMessage";
import type {
  LocalNostrMessage,
  NewLocalNostrMessage,
  PaymentLogData,
  UpdateLocalNostrMessage,
} from "../../types/appTypes";
import { buildUnknownContactId, normalizePubkeyHex } from "./contactIdentity";
import { trimString } from "../../../utils/validation";

const chatMessageContentFromBody = (body: MessageBody): string => {
  switch (body._tag) {
    case "TextBody":
      return body.text;
    case "TokenBody":
      return body.token;
    case "ImageBody":
      return serializePrivateImageMessage({
        encryptedSha256: body.image.encryptedSha256,
        encryptedSize: body.image.encryptedSize,
        encryptionAlgorithm: body.image.encryptionAlgorithm,
        fileType: body.image.fileType,
        key: body.image.key,
        nonce: body.image.nonce,
        originalSha256: body.image.originalSha256,
        storageEncoding: body.image.storageEncoding,
        type: "linky.private_image.v1",
        url: body.image.url,
        ...(body.image.width !== undefined && body.image.height !== undefined
          ? { width: body.image.width, height: body.image.height }
          : {}),
        ...(body.image.fileName !== undefined
          ? { fileName: body.image.fileName }
          : {}),
      });
  }
};

export interface ChatInboxContext {
  appendLocalNostrMessage: (message: NewLocalNostrMessage) => string;
  identitySinceSec: number | null;
  isBlockedPubkey: (pubkey: string) => boolean;
  logPayStep: (step: string, data?: PaymentLogData) => void;
  messages: readonly LocalNostrMessage[];
  /** Known-contact lookup; unknown senders fall back to a synthetic id. */
  resolveContactId: (peerPubkey: string) => string | null;
  updateLocalNostrMessage: UpdateLocalNostrMessage;
}

export interface InsertedChatMessage {
  contactId: string;
  content: string;
  createdAtSec: number;
  /** Local row id of the appended message. */
  messageId: string;
  peerPubkey: string;
}

const matchesIncomingConversation = (
  message: LocalNostrMessage,
  contactId: string,
  peerPubkey: string,
): boolean =>
  trimString(message.direction) === "in" &&
  (trimString(message.contactId) === contactId ||
    normalizePubkeyHex(message.pubkey) === peerPubkey);

export const applyChatMessageReceived = (
  event: ChatMessageReceived,
  ctx: ChatInboxContext,
): InsertedChatMessage | null => {
  if (ctx.isBlockedPubkey(event.from)) return null;
  if (ctx.identitySinceSec !== null && event.sentAt < ctx.identitySinceSec) {
    return null;
  }
  const contactId =
    ctx.resolveContactId(event.from) ?? buildUnknownContactId(event.from);
  if (!contactId) return null;

  const content = chatMessageContentFromBody(event.body);
  const scoped = ctx.messages.filter((message) =>
    matchesIncomingConversation(message, contactId, event.from),
  );

  if (event.editOf !== null) {
    const editOf = event.editOf;
    const target = scoped.find(
      (message) =>
        trimString(message.rumorId) === editOf ||
        trimString(message.editedFromId) === editOf,
    );
    if (target) {
      // A replayed backfill must not roll an already-applied newer edit back.
      if (target.isEdited && (target.editedAtSec ?? 0) >= event.sentAt) {
        return null;
      }
      const targetId = trimString(target.id);
      if (!targetId) return null;
      const existingOriginal =
        trimString(target.originalContent) || target.content;
      ctx.updateLocalNostrMessage(targetId, {
        content,
        status: "sent",
        pubkey: event.from,
        rumorId: editOf,
        isEdited: true,
        editedAtSec: event.sentAt,
        editedFromId: editOf,
        originalContent: existingOriginal || null,
      });
      return null;
    }
  } else {
    const editedVersion = scoped.find(
      (message) => trimString(message.editedFromId) === event.messageId,
    );
    if (editedVersion) {
      const editedVersionId = trimString(editedVersion.id);
      if (!trimString(editedVersion.originalContent) && editedVersionId) {
        ctx.updateLocalNostrMessage(editedVersionId, {
          originalContent: content,
        });
      }
      return null;
    }
  }

  const stableRumorId = event.editOf ?? event.messageId;
  const existing = scoped.find(
    (message) => trimString(message.rumorId) === stableRumorId,
  );
  if (existing) {
    if ((existing.status ?? "sent") === "pending") {
      ctx.updateLocalNostrMessage(trimString(existing.id), { status: "sent" });
    }
    return null;
  }

  const rowId = ctx.appendLocalNostrMessage({
    contactId,
    direction: "in",
    content,
    // Rows born from linkstr events have no wrap id; the rumor id is the
    // stable identity and doubles as the row's unique wrapId key.
    wrapId: event.messageId,
    rumorId: stableRumorId,
    pubkey: event.from,
    createdAtSec: event.sentAt,
    status: "sent",
    ...(event.replyTo !== null ? { replyToId: event.replyTo } : {}),
    ...(event.root !== null ? { rootMessageId: event.root } : {}),
    ...(event.editOf !== null
      ? {
          isEdited: true,
          editedAtSec: event.sentAt,
          editedFromId: event.editOf,
        }
      : {}),
  });
  if (!rowId) return null;
  return {
    contactId,
    content,
    createdAtSec: event.sentAt,
    messageId: rowId,
    peerPubkey: event.from,
  };
};

/**
 * Reconcile-only by design: same-identity devices share Evolu, so the sending
 * device's row is the sole cross-device propagation path for own messages. An
 * echo that matches no row is dropped, never appended.
 */
export const applyOwnChatMessageConfirmed = (
  event: OwnChatMessageConfirmed,
  ctx: ChatInboxContext,
): void => {
  if (ctx.identitySinceSec !== null && event.sentAt < ctx.identitySinceSec) {
    return;
  }
  const outgoing = ctx.messages.filter(
    (message) => trimString(message.direction) === "out",
  );
  const row =
    (event.clientId !== null
      ? outgoing.find(
          (message) => trimString(message.clientId) === event.clientId,
        )
      : undefined) ??
    outgoing.find((message) => trimString(message.rumorId) === event.messageId);
  if (!row) return;
  if ((row.status ?? "sent") !== "pending") return;

  ctx.updateLocalNostrMessage(trimString(row.id), {
    status: "sent",
    ...(trimString(row.rumorId)
      ? {}
      : { rumorId: event.editOf ?? event.messageId }),
  });
  ctx.logPayStep("message-ack", {
    contactId: trimString(row.contactId),
    clientId: event.clientId,
    rumorId: event.messageId,
  });
};
