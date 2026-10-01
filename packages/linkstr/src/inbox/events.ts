import { Schema } from "effect";
import { WrapId } from "../domain/primitives";

/**
 * Receive phase of a wrap: "backfill" until its relay signals EOSE, "live"
 * after. Only live events should interrupt the user; a relay that never sends
 * EOSE conservatively stays in backfill (a missed interruption, never a
 * spurious one).
 */
export const InboxDelivery = Schema.Literals(["backfill", "live"]);
export type InboxDelivery = typeof InboxDelivery.Type;

// Each new vertical adds its own reason so drops never masquerade as another vertical's failure.
export const DropReason = Schema.Literals([
  "malformed-wrap",
  "invalid-wrap",
  "invalid-rumor-timestamp",
  "not-addressed-to-me",
  "unwrap-failed",
  "invalid-seal",
  "sender-forged",
  "malformed-rumor",
  "forged-rumor-id",
  "unsupported-kind",
  "invalid-reaction",
  "invalid-retraction",
  "invalid-message",
  "invalid-image",
  "invalid-edit",
  "empty-message",
  "nested-payload",
  "invalid-notice",
  "invalid-bank-offer",
  "invalid-seen-receipt",
]);
export type DropReason = typeof DropReason.Type;

/** A wrap we chose not to surface, with a typed, observable reason. */
export class WrapDropped extends Schema.TaggedClass<WrapDropped>()(
  "WrapDropped",
  {
    wrapId: Schema.NullOr(WrapId),
    reason: DropReason,
  },
) {}
