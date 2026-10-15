import { parseCashuPaymentRequestMessage } from "../../lib/paymentRequestMessage";
import { reportAppLog } from "../../../devtools/inspector/appLog";
import type {
  ChatMessageDeleted,
  ChatMessageReceived,
  MessageBody,
  OwnChatMessageConfirmed,
  OwnChatMessageDeletionConfirmed,
} from "@linky-fit/linkstr";
import { serializePrivateImageMessage } from "../../lib/privateImageMessage";
import { allWrites, NO_WRITE, type WriteOutcome } from "../../lib/storeWrite";
import type {
  AppendLocalNostrMessage,
  LocalNostrMessage,
  PaymentLogData,
  UpdateLocalNostrMessage,
} from "../../types/appTypes";
import {
  carriesPayment,
  DELETED_MESSAGE_CONTENT,
  isDeletedMessage,
} from "../../lib/deletedMessage";
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
  appendLocalNostrMessage: AppendLocalNostrMessage;
  identitySinceSec: number | null;
  isBlockedPubkey: (pubkey: string) => boolean;
  logPayStep: (step: string, data?: PaymentLogData) => void;
  messages: readonly LocalNostrMessage[];
  /** Turns a stored message into a deleted-message placeholder and drops its reactions. */
  markLocalNostrMessageDeleted: (
    message: LocalNostrMessage,
  ) => Promise<WriteOutcome>;
  /** Known-contact lookup; unknown senders fall back to a synthetic id. */
  resolveContactId: (peerPubkey: string) => string | null;
  updateLocalNostrMessage: UpdateLocalNostrMessage;
  /**
   * When the oldest visible messages shard began; a message or reaction sent
   * before it is not stored, since its row may sit in a forgotten shard (a
   * removed one included) and it would count as read anyway.
   */
  visibleSinceSec: number | null;
}

export interface InsertedChatMessage {
  contactId: string;
  content: string;
  createdAtSec: number;
  /** Local row id of the appended message. */
  messageId: string;
  peerPubkey: string;
}

export interface HandledChatMessage {
  /** The message stored as new; null for an edit, a duplicate or a drop. */
  inserted: InsertedChatMessage | null;
  written: Promise<WriteOutcome>;
}

const NOTHING_INSERTED: HandledChatMessage = {
  inserted: null,
  written: NO_WRITE,
};

const updatedOnly = (written: Promise<WriteOutcome>): HandledChatMessage => ({
  inserted: null,
  written,
});

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
): HandledChatMessage => {
  if (ctx.isBlockedPubkey(event.from)) return NOTHING_INSERTED;
  if (ctx.identitySinceSec !== null && event.sentAt < ctx.identitySinceSec) {
    return NOTHING_INSERTED;
  }
  if (ctx.visibleSinceSec !== null && event.sentAt < ctx.visibleSinceSec) {
    return NOTHING_INSERTED;
  }
  const contactId =
    ctx.resolveContactId(event.from) ?? buildUnknownContactId(event.from);
  if (!contactId) return NOTHING_INSERTED;

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
    if (
      parseCashuPaymentRequestMessage(content) ||
      (target &&
        parseCashuPaymentRequestMessage(
          target.originalContent || target.content,
        ))
    ) {
      reportAppLog({
        tag: "paymentRequest.editRejected",
        summary: "Ignored an edit to an immutable payment request",
        links: { rumor: event.messageId, message: editOf },
        payload: null,
      });
      return NOTHING_INSERTED;
    }
    if (target) {
      if (isDeletedMessage(target)) return NOTHING_INSERTED;
      // A replayed backfill must not roll an already-applied newer edit back.
      if (target.isEdited && (target.editedAtSec ?? 0) >= event.sentAt) {
        return NOTHING_INSERTED;
      }
      const targetId = trimString(target.id);
      if (!targetId) return NOTHING_INSERTED;
      const existingOriginal =
        trimString(target.originalContent) || target.content;
      return updatedOnly(
        ctx.updateLocalNostrMessage(targetId, {
          content,
          status: "sent",
          pubkey: event.from,
          rumorId: editOf,
          isEdited: true,
          editedAtSec: event.sentAt,
          editedFromId: editOf,
          originalContent: existingOriginal || null,
        }),
      );
    }
  } else {
    const editedVersion = scoped.find(
      (message) => trimString(message.editedFromId) === event.messageId,
    );
    if (editedVersion && parseCashuPaymentRequestMessage(content)) {
      return updatedOnly(
        ctx.updateLocalNostrMessage(editedVersion.id, {
          content,
          originalContent: null,
          isEdited: false,
          editedAtSec: null,
          editedFromId: null,
          createdAtSec: event.sentAt,
          rumorId: event.messageId,
          wrapId: event.messageId,
          pubkey: event.from,
        }),
      );
    }
    if (editedVersion) {
      const editedVersionId = trimString(editedVersion.id);
      return !trimString(editedVersion.originalContent) &&
        !isDeletedMessage(editedVersion) &&
        editedVersionId
        ? updatedOnly(
            ctx.updateLocalNostrMessage(editedVersionId, {
              originalContent: content,
            }),
          )
        : NOTHING_INSERTED;
    }
  }

  const stableRumorId = event.editOf ?? event.messageId;
  const existing = scoped.find(
    (message) =>
      trimString(message.rumorId) === stableRumorId ||
      (event.clientId !== null && message.clientId === event.clientId),
  );
  if (existing) {
    return (existing.status ?? "sent") === "pending"
      ? updatedOnly(
          ctx.updateLocalNostrMessage(trimString(existing.id), {
            status: "sent",
          }),
        )
      : NOTHING_INSERTED;
  }

  const appended = ctx.appendLocalNostrMessage({
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
    ...(event.clientId !== null ? { clientId: event.clientId } : {}),
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
  if (!appended.id) return NOTHING_INSERTED;
  return {
    inserted: {
      contactId,
      content,
      createdAtSec: event.sentAt,
      messageId: appended.id,
      peerPubkey: event.from,
    },
    written: appended.written,
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
): Promise<WriteOutcome> => {
  if (ctx.identitySinceSec !== null && event.sentAt < ctx.identitySinceSec) {
    return NO_WRITE;
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
  if (!row) return NO_WRITE;
  if ((row.status ?? "sent") !== "pending") return NO_WRITE;

  const written = ctx.updateLocalNostrMessage(trimString(row.id), {
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
  return written;
};

const appendDeletedPlaceholder = (
  event: ChatMessageDeleted,
  contactId: string,
  ctx: ChatInboxContext,
): Promise<WriteOutcome> => {
  if (ctx.visibleSinceSec !== null && event.sentAt < ctx.visibleSinceSec) {
    return NO_WRITE;
  }
  reportAppLog({
    tag: "messages.deletedBeforeArrival",
    summary:
      "Kept a placeholder for a message the peer deleted before it arrived",
    links: {
      rumor: event.deletionId,
      message: event.deleteOf,
      pubkey: event.from,
    },
    payload: null,
  });
  return ctx.appendLocalNostrMessage({
    contactId,
    direction: "in",
    content: DELETED_MESSAGE_CONTENT,
    wrapId: event.deleteOf,
    rumorId: event.deleteOf,
    pubkey: event.from,
    createdAtSec: event.sentAt,
    deletedAtSec: event.sentAt,
    status: "sent",
  }).written;
};

/**
 * A deletion names only a rumor id, so the message is looked up within the
 * conversation with the peer: a peer can delete any message of that chat
 * except one carrying a payment, and nothing outside it. A peer's deletion
 * that arrives before its message leaves a placeholder under that rumor id,
 * which the message then dedupes against. The own echo mostly finds nothing
 * left to do, since the deleting device marked the row and Evolu synced that;
 * it stays idempotent.
 */
export const applyChatMessageDeletion = (
  event: ChatMessageDeleted | OwnChatMessageDeletionConfirmed,
  ctx: ChatInboxContext,
): Promise<WriteOutcome> => {
  const byPeer = event._tag === "ChatMessageDeleted";
  const peer = byPeer ? event.from : event.to;
  if (byPeer && ctx.isBlockedPubkey(peer)) return NO_WRITE;
  if (ctx.identitySinceSec !== null && event.sentAt < ctx.identitySinceSec) {
    return NO_WRITE;
  }
  const contactId = ctx.resolveContactId(peer) ?? buildUnknownContactId(peer);
  if (!contactId) return NO_WRITE;

  const matches = ctx.messages.filter(
    (message) =>
      (trimString(message.contactId) === contactId ||
        matchesIncomingConversation(message, contactId, peer)) &&
      (trimString(message.rumorId) === event.deleteOf ||
        trimString(message.editedFromId) === event.deleteOf),
  );
  if (matches.length === 0) {
    return byPeer ? appendDeletedPlaceholder(event, contactId, ctx) : NO_WRITE;
  }
  const targets = matches.filter(
    (message) => !isDeletedMessage(message) && !carriesPayment(message.content),
  );
  if (targets.length === 0) return NO_WRITE;
  reportAppLog({
    tag: byPeer ? "messages.deletedByPeer" : "messages.deletionConfirmed",
    summary: byPeer
      ? "Replaced a message the peer deleted with a placeholder"
      : "Replaced a message deleted from another device with a placeholder",
    links: { rumor: event.deletionId, message: event.deleteOf, pubkey: peer },
    payload: { deleted: targets.length },
  });
  return allWrites(
    targets.map((message) => ctx.markLocalNostrMessageDeleted(message)),
  );
};
