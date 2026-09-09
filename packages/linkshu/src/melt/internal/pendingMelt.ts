import { Schema } from "effect";
import {
  Amount,
  Bolt11Invoice,
  CurrencyUnit,
  KeysetId,
  MintUrl,
  NonNegativeAmount,
  QuoteId,
  TokenRowId,
  UnixSeconds,
} from "../../domain/primitives";
import { pendingRecordStore } from "../../internal/pendingRecords";

/**
 * Melt's durable bookkeeping. The record lands next to the `reserved` inputs
 * row before the melt request leaves, so a payment whose outcome the process
 * never saw — PENDING past the poll budget, a lost response, a crash — is
 * always reconstructible from storage: the quote to ask about, the row the
 * mint may still hold, and the blank-output slots whose change NUT-09 can
 * hand back.
 */

export const PENDING_MELT_KEY_PREFIX = "linkshu.pendingMelt.";

/** Only the mint's own answer retires a melt record; time alone never does. */
export const PENDING_MELT_TTL_SECONDS = 24 * 60 * 60;

export class PendingMelt extends Schema.Class<PendingMelt>("PendingMelt")({
  quoteId: QuoteId,
  mint: MintUrl,
  unit: CurrencyUnit,
  keysetId: KeysetId,
  invoice: Bolt11Invoice,
  amount: Amount,
  feeReserve: NonNegativeAmount,
  /** Sum of the melt inputs parked in `rowId`. */
  inputsTotal: Amount,
  /** The `reserved` row holding the melt inputs while the mint has them. */
  rowId: TokenRowId,
  /** Mint-stated quote expiry; null when the mint sets none. */
  expiresAt: Schema.NullOr(UnixSeconds),
  createdAt: UnixSeconds,
  /**
   * First deterministic slot of the NUT-08 blank outputs the latest melt
   * attempt sent, or null before any attempt reached the mint. Persisted
   * before the counter advances, so change can be re-derived after a crash.
   */
  blankCounter: Schema.NullOr(Schema.Int),
}) {}

export const pendingMelts = pendingRecordStore(
  PENDING_MELT_KEY_PREFIX,
  PendingMelt,
  PENDING_MELT_TTL_SECONDS,
);
