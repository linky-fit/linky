import { Schema } from "effect";
import {
  CounterLockTimeout,
  InsufficientFunds,
  MintRejected,
  MintUnreachable,
  PaymentFailed,
  QuoteExpired,
} from "../domain/errors";
import {
  Amount,
  Bolt11Invoice,
  MintUrl,
  NonNegativeAmount,
  QuoteId,
  UnixSeconds,
} from "../domain/primitives";

export class MeltDraft extends Schema.Class<MeltDraft>("MeltDraft")({
  mint: MintUrl,
  invoice: Bolt11Invoice,
  quoteId: Schema.optional(QuoteId),
}) {}

/** A priced melt offer — what a confirmation UI shows before paying. */
export class MeltQuote extends Schema.Class<MeltQuote>("MeltQuote")({
  quoteId: QuoteId,
  mint: MintUrl,
  amount: Amount,
  feeReserve: NonNegativeAmount,
  expiresAt: Schema.NullOr(UnixSeconds),
}) {}

export class MeltReceipt extends Schema.Class<MeltReceipt>("MeltReceipt")({
  mint: MintUrl,
  quoteId: QuoteId,
  paidAmount: Amount,
  feeReserve: NonNegativeAmount,
  /** Actual Lightning fee charged; may be 0 even when `feeReserve` > 0. */
  feePaid: NonNegativeAmount,
  /** NUT-08 change returned to the wallet as a fresh `accepted` row. */
  changeAmount: NonNegativeAmount,
}) {}

export const MeltError = Schema.Union(
  InsufficientFunds,
  MintUnreachable,
  MintRejected,
  PaymentFailed,
  QuoteExpired,
  CounterLockTimeout,
);
export type MeltError = typeof MeltError.Type;
