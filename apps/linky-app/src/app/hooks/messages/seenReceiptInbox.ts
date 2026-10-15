import type {
  OwnSeenReceiptConfirmed,
  SeenReceiptReceived,
} from "@linky-fit/linkstr";
import { NO_WRITE, type WriteOutcome } from "../../lib/storeWrite";

/** Peer's reported seen window: our messages in (sinceSec, seenUpToSec]. */
export interface PeerSeenWindow {
  sinceSec: number;
  seenUpToSec: number;
}

// A hostile peer could report a far-future cursor that would mark every
// message seen forever; clamp what we accept to shortly after "now".
const PEER_SEEN_FUTURE_MARGIN_SEC = 24 * 60 * 60;

export interface SeenReceiptInboxContext {
  advanceContactPeerSeen: (
    contactId: string,
    window: PeerSeenWindow,
  ) => Promise<WriteOutcome>;
  findContactId: (pubkey: string) => string | null;
  getPeerSeenWindow: (contactId: string) => PeerSeenWindow | null;
  identitySinceSec: number | null;
  isBlockedPubkey: (pubkey: string) => boolean;
  nowSec: number;
  recordSentSeenReceipt: (peerPubkey: string, seenUpToSec: number) => void;
}

/**
 * Monotonic by seenUpToSec, so replaying the inbox backfill window is a
 * no-op: only a receipt that moves the cursor forward produces a write.
 */
export const resolvePeerSeenAdvance = (
  current: PeerSeenWindow | null,
  incoming: PeerSeenWindow,
  nowSec: number,
): PeerSeenWindow | null => {
  const seenUpToSec = Math.min(
    incoming.seenUpToSec,
    nowSec + PEER_SEEN_FUTURE_MARGIN_SEC,
  );
  if (incoming.sinceSec >= seenUpToSec) return null;
  if (current !== null && seenUpToSec <= current.seenUpToSec) return null;
  return { sinceSec: incoming.sinceSec, seenUpToSec };
};

export const applySeenReceiptReceived = (
  event: SeenReceiptReceived,
  ctx: SeenReceiptInboxContext,
): Promise<WriteOutcome> => {
  if (ctx.isBlockedPubkey(event.from)) return NO_WRITE;
  if (ctx.identitySinceSec !== null && event.sentAt < ctx.identitySinceSec) {
    return NO_WRITE;
  }
  // Receipts from unknown-contact threads are dropped: they have no contact
  // row to hold the window, and their chats show no seen state anyway.
  const contactId = ctx.findContactId(event.from);
  if (contactId === null) return NO_WRITE;

  const advance = resolvePeerSeenAdvance(
    ctx.getPeerSeenWindow(contactId),
    { sinceSec: event.sinceSec, seenUpToSec: event.seenUpToSec },
    ctx.nowSec,
  );
  return advance === null
    ? NO_WRITE
    : ctx.advanceContactPeerSeen(contactId, advance);
};

/**
 * Echo of a receipt we sent (this or another device). Seeds the "already
 * reported up to" map so sessions and devices don't resend receipts the peer
 * already has — the 2-day inbox replay restores it on every startup.
 */
export const applyOwnSeenReceiptConfirmed = (
  event: OwnSeenReceiptConfirmed,
  ctx: SeenReceiptInboxContext,
): void => {
  ctx.recordSentSeenReceipt(event.to, event.seenUpToSec);
};
