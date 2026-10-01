import { Schema } from "effect";
import { ClientId, Pubkey, RumorId, UnixSeconds } from "../domain/primitives";

/** The peer reports having seen our messages in (sinceSec, seenUpToSec]. */
export class SeenReceiptReceived extends Schema.TaggedClass<SeenReceiptReceived>()(
  "SeenReceiptReceived",
  {
    receiptId: RumorId,
    from: Pubkey,
    sinceSec: UnixSeconds,
    seenUpToSec: UnixSeconds,
    sentAt: UnixSeconds,
  },
) {}

/**
 * Our own receipt observed on a relay — the echo of the self copy, or a send
 * from another device. Seeds "already reported up to" so devices and sessions
 * don't resend receipts the peer already has.
 */
export class OwnSeenReceiptConfirmed extends Schema.TaggedClass<OwnSeenReceiptConfirmed>()(
  "OwnSeenReceiptConfirmed",
  {
    receiptId: RumorId,
    to: Pubkey,
    sinceSec: UnixSeconds,
    seenUpToSec: UnixSeconds,
    clientId: Schema.NullOr(ClientId),
    sentAt: UnixSeconds,
  },
) {}

export const SeenReceiptInboxEvent = Schema.Union([
  SeenReceiptReceived,
  OwnSeenReceiptConfirmed,
]);
export type SeenReceiptInboxEvent = typeof SeenReceiptInboxEvent.Type;
