import { Schema } from "effect";
import {
  Amount,
  Bolt11Invoice,
  CurrencyUnit,
  KeysetId,
  MintUrl,
  QuoteId,
  UnixSeconds,
} from "../../domain/primitives";
import { pendingRecordStore } from "../../internal/pendingRecords";

/**
 * Topup's durable bookkeeping. A record is written before every network call
 * that could strand funds, so an interrupted topup is always reconstructible
 * from storage alone: the quote to poll, and the counter slots a mint attempt
 * has already burned.
 */

export const PENDING_TOPUP_KEY_PREFIX = "linkshu.pendingTopup.";

/**
 * Poll deadline for quotes without a mint-stated expiry: past it the poll
 * ends at the next mint-confirmed UNPAID answer instead of running forever.
 */
export const PENDING_TOPUP_TTL_SECONDS = 24 * 60 * 60;

export class PendingTopup extends Schema.Class<PendingTopup>("PendingTopup")({
  quoteId: QuoteId,
  mint: MintUrl,
  unit: CurrencyUnit,
  keysetId: KeysetId,
  amount: Amount,
  invoice: Bolt11Invoice,
  /** Mint-stated quote expiry; null when the mint sets none. */
  expiresAt: Schema.NullOr(UnixSeconds),
  createdAt: UnixSeconds,
  /**
   * First deterministic slot reserved for this quote's mint attempt, or null
   * before any attempt. Set (and persisted) before the outputs are derived,
   * so a resumed attempt re-derives exactly the same blinded messages instead
   * of burning a second block.
   */
  mintCounter: Schema.NullOr(Schema.Int),
  /** NUT-20 locked quote: minting needs the owner's key. Absent in records written before adoption existed. */
  locked: Schema.optionalWith(Schema.Boolean, { default: () => false }),
}) {}

export const pendingTopups = pendingRecordStore(
  PENDING_TOPUP_KEY_PREFIX,
  PendingTopup,
  PENDING_TOPUP_TTL_SECONDS,
);
