// Migration bridge; removal gate in app/migrations/AGENTS.md
//
// Messages from unknown senders used to live in a device-local overlay in
// localStorage. Each hydrated device imports its overlay into the
// `unknownSenders` scope, so its other devices see the messages too, and
// then clears the overlay.

import { isRumorId } from "@linky-fit/linkstr";
import {
  createId,
  MessageId,
  nostrMessageIdFor,
  type LinkyDbSchema,
  type WriteRow,
} from "@linky-fit/linksync";
import { LOCAL_NOSTR_MESSAGES_STORAGE_KEY_PREFIX } from "../../utils/constants";
import { trimString } from "../../utils/validation";
import { readUnknownContactIdPubkey } from "../hooks/messages/contactIdentity";
import {
  normalizeLegacyLocalMessage,
  toUnknownSenderWriteRow,
} from "../hooks/messages/messageRows";
import type { LocalNostrMessage } from "../types/appTypes";

export const unknownSenderOverlayKey = (ownerId: string): string =>
  `${LOCAL_NOSTR_MESSAGES_STORAGE_KEY_PREFIX}.overlay.${ownerId}`;

const messageIdOf = (message: LocalNostrMessage): MessageId => {
  const rumorId = trimString(message.rumorId);
  if (isRumorId(rumorId)) return nostrMessageIdFor(rumorId);
  const stored = MessageId.fromUnknown(message.id);
  return stored.ok ? stored.value : createId<"Message">();
};

/** The overlay's messages as unknown-sender rows; messages of blocked senders and unreadable entries are left out. */
export const overlayRowsToImport = (
  overlay: ReadonlyArray<Record<string, unknown>>,
  isBlockedPubkey: (pubkey: string) => boolean,
): ReadonlyArray<WriteRow<LinkyDbSchema["unknownSenderMessage"]>> =>
  overlay.flatMap((entry) => {
    const message = normalizeLegacyLocalMessage(entry);
    const peerPubkey = message && readUnknownContactIdPubkey(message.contactId);
    if (!message || !peerPubkey || isBlockedPubkey(peerPubkey)) return [];
    const row = toUnknownSenderWriteRow(
      messageIdOf(message),
      peerPubkey,
      message,
      message.wrapId,
    );
    return row ? [row] : [];
  });
