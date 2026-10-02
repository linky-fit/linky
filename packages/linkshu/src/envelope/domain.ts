import { Schema } from "effect";
import {
  AmountConsumedByFee,
  CounterLockTimeout,
  EnvelopeBusy,
  EnvelopeNotFound,
  InsufficientFunds,
  MintRejected,
  MintUnreachable,
  TokenAlreadySpent,
} from "../domain/errors";
import {
  Amount,
  Bolt11Invoice,
  EnvelopeKey,
  MintUrl,
  NonNegativeAmount,
  OperationId,
  QuoteId,
  TokenText,
} from "../domain/primitives";
import { MeltError } from "../melt/domain";

/** One envelope: the mint it lives at and the caller's key for it. */
export class EnvelopeRef extends Schema.Class<EnvelopeRef>("EnvelopeRef")({
  mint: MintUrl,
  key: EnvelopeKey,
}) {}

export class EnvelopeOpenDraft extends Schema.Class<EnvelopeOpenDraft>(
  "EnvelopeOpenDraft",
)({
  mint: MintUrl,
  key: EnvelopeKey,
  /** Used only when this call funds the envelope. */
  amount: Amount,
}) {}

export class EnvelopeOpened extends Schema.Class<EnvelopeOpened>(
  "EnvelopeOpened",
)({
  /**
   * `created`: this call funded the envelope; `adopted`: it already existed,
   * funded by another device or tab, or by an earlier call here (one whose
   * answer was lost included).
   */
  outcome: Schema.Literal("created", "adopted"),
  /** The `envelope` operation holding the proofs. */
  operationId: OperationId,
  /** What the envelope holds; an adopted one keeps its creator's amount. */
  amount: Amount,
}) {}

/**
 * The mint's view of an envelope: `absent` (never funded), `unspent`,
 * `pending` (an input of an unsettled melt), `spent` (melted or redeemed),
 * or `mixed` (some proofs spent, some not).
 */
export const EnvelopeStatus = Schema.Literal(
  "absent",
  "unspent",
  "pending",
  "spent",
  "mixed",
);
export type EnvelopeStatus = typeof EnvelopeStatus.Type;

export class EnvelopeState extends Schema.Class<EnvelopeState>("EnvelopeState")(
  {
    status: EnvelopeStatus,
    /** What the mint signed into the envelope; 0 when absent. */
    amount: NonNegativeAmount,
    /** The local `envelope` operation; null when absent. */
    operationId: Schema.NullOr(OperationId),
  },
) {}

export class EnvelopeToken extends Schema.Class<EnvelopeToken>("EnvelopeToken")(
  {
    operationId: OperationId,
    /** The same text on every device; spendable, keep it out of logs. */
    tokenText: TokenText,
    amount: Amount,
  },
) {}

export class EnvelopeReleased extends Schema.Class<EnvelopeReleased>(
  "EnvelopeReleased",
)({
  /** Fresh `available` balance after the mint's fee; 0 when nothing was unspent. */
  amount: NonNegativeAmount,
}) {}

export class EnvelopeMeltDraft extends Schema.Class<EnvelopeMeltDraft>(
  "EnvelopeMeltDraft",
)({
  mint: MintUrl,
  key: EnvelopeKey,
  /** Must ask for exactly the envelope's amount. */
  invoice: Bolt11Invoice,
  quoteId: Schema.optional(QuoteId),
}) {}

export const EnvelopeOpenError = Schema.Union(
  InsufficientFunds,
  AmountConsumedByFee,
  MintUnreachable,
  MintRejected,
  CounterLockTimeout,
  EnvelopeBusy,
);
export type EnvelopeOpenError = typeof EnvelopeOpenError.Type;

export const EnvelopeSendError = Schema.Union(EnvelopeNotFound, EnvelopeBusy);
export type EnvelopeSendError = typeof EnvelopeSendError.Type;

export const EnvelopeStateError = Schema.Union(MintUnreachable, MintRejected);
export type EnvelopeStateError = typeof EnvelopeStateError.Type;

export const EnvelopeReleaseError = Schema.Union(
  MintUnreachable,
  MintRejected,
  TokenAlreadySpent,
  CounterLockTimeout,
  EnvelopeBusy,
);
export type EnvelopeReleaseError = typeof EnvelopeReleaseError.Type;

export const EnvelopeMeltError = Schema.Union(
  MeltError,
  EnvelopeNotFound,
  EnvelopeBusy,
);
export type EnvelopeMeltError = typeof EnvelopeMeltError.Type;
