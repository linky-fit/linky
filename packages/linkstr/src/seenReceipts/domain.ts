import { Schema } from "effect";
import { WrapDelivery } from "../domain/delivery";
import { ClientId, Pubkey, RumorId, UnixSeconds } from "../domain/primitives";

/**
 * Read-receipt window cursor: "I have seen your messages in (sinceSec,
 * seenUpToSec]". `sinceSec` is the sender's receipts-enabled baseline, so
 * messages older than the feature stay unmarked on the peer's side.
 */
export class SeenReceiptDraft extends Schema.Class<SeenReceiptDraft>(
  "SeenReceiptDraft",
)({
  /** Conversation peer whose messages were seen. */
  to: Pubkey,
  sinceSec: UnixSeconds,
  seenUpToSec: UnixSeconds,
  /** Generated when omitted. */
  clientId: Schema.optional(ClientId),
  sentAt: Schema.optional(UnixSeconds),
}) {}

export class SeenReceiptSendReceipt extends Schema.TaggedClass<SeenReceiptSendReceipt>()(
  "SeenReceiptSendReceipt",
  {
    rumorId: RumorId,
    clientId: ClientId,
    sentAt: UnixSeconds,
    selfCopy: WrapDelivery,
    recipientCopy: WrapDelivery,
  },
) {}
