import { Schema } from "effect";
import {
  CounterLockTimeout,
  InsufficientFunds,
  MintRejected,
  MintUnreachable,
  PaymentFailed,
  PaymentPending,
  QuoteExpired,
} from "../domain/errors";
import {
  Amount,
  Bolt11Invoice,
  MintUrl,
  NonNegativeAmount,
  OperationId,
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
  /** NUT-08 change returned to the wallet as fresh `available` proofs. */
  changeAmount: NonNegativeAmount,
}) {}

/** What `resumePending` did with one persisted melt record. */
export class MeltResumeResult extends Schema.Class<MeltResumeResult>(
  "MeltResumeResult",
)({
  quoteId: QuoteId,
  mint: MintUrl,
  /** The `melt` operation holding the inputs. */
  operationId: OperationId,
  amount: Amount,
  /**
   * `paid` — settled, change persisted, record closed; `unpaid` — inputs
   * back in balance, record closed; `pending` — the mint still reports the
   * payment in flight, record kept; `unresolved` — no usable mint answer,
   * record kept for the next pass.
   */
  status: Schema.Literal("paid", "unpaid", "pending", "unresolved"),
  /** Set only for `paid`. */
  receipt: Schema.NullOr(MeltReceipt),
}) {}

export const MeltError = Schema.Union(
  InsufficientFunds,
  MintUnreachable,
  MintRejected,
  PaymentFailed,
  PaymentPending,
  QuoteExpired,
  CounterLockTimeout,
);
export type MeltError = typeof MeltError.Type;
