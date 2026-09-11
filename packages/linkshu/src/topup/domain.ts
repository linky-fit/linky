import { Effect, Schema } from "effect";
import {
  CounterLockTimeout,
  MintRejected,
  MintUnreachable,
  QuoteAlreadyIssued,
  QuoteExpired,
} from "../domain/errors";
import {
  Amount,
  Bolt11Invoice,
  MintUrl,
  OperationId,
  QuoteId,
  TokenText,
  UnixSeconds,
} from "../domain/primitives";

export class TopupDraft extends Schema.Class<TopupDraft>("TopupDraft")({
  mint: MintUrl,
  amount: Amount,
}) {}

/** The mint quote to display: pay `invoice` and the topup completes itself. */
export class TopupQuote extends Schema.Class<TopupQuote>("TopupQuote")({
  quoteId: QuoteId,
  mint: MintUrl,
  amount: Amount,
  invoice: Bolt11Invoice,
  expiresAt: Schema.NullOr(UnixSeconds),
}) {}

export class TopupReceipt extends Schema.Class<TopupReceipt>("TopupReceipt")({
  /** The `topup` operation, now `done`. */
  operationId: OperationId,
  /** The minted proofs, encoded; they are stored as `available`. */
  tokenText: TokenText,
  mint: MintUrl,
  amount: Amount,
  quoteId: QuoteId,
}) {}

export const TopupError = Schema.Union(
  MintUnreachable,
  MintRejected,
  QuoteExpired,
  CounterLockTimeout,
);
export type TopupError = typeof TopupError.Type;

/**
 * A bolt11 mint quote created and settled outside this wallet: a lightning
 * address server requested it at `mint` on the owner's behalf and reports the
 * invoice paid. A `locked` quote (NUT-20) is bound to the owner's key.
 */
export class PaidQuoteDraft extends Schema.Class<PaidQuoteDraft>(
  "PaidQuoteDraft",
)({
  quoteId: QuoteId,
  mint: MintUrl,
  amount: Amount,
  invoice: Bolt11Invoice,
  expiresAt: Schema.NullOr(UnixSeconds),
  locked: Schema.Boolean,
}) {}

/** Hex secp256k1 secret a NUT-20 locked quote is bound to; never persisted. */
export const QuoteLockingKey = Schema.String.pipe(
  Schema.pattern(/^[0-9a-f]{64}$/),
  Schema.brand("QuoteLockingKey"),
);
export type QuoteLockingKey = typeof QuoteLockingKey.Type;

export interface TopupLockingOptions {
  /** Unlocks NUT-20 locked quotes; a locked record without it is rejected. */
  readonly lockingKey?: QuoteLockingKey | undefined;
}

export const TopupAdoptError = Schema.Union(
  MintUnreachable,
  MintRejected,
  QuoteAlreadyIssued,
  CounterLockTimeout,
);
export type TopupAdoptError = typeof TopupAdoptError.Type;

/**
 * A running topup: `quote` is available immediately for display; `result`
 * resolves once the invoice is paid and the proofs are minted and persisted.
 * The handle is scoped — closing the scope stops the polling, while the
 * persisted quote stays claimable through `resumePending` for a day.
 */
export interface TopupHandle {
  readonly quote: TopupQuote;
  readonly result: Effect.Effect<TopupReceipt, TopupError>;
}
