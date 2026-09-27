import { Schema } from "effect";
import {
  CounterLockTimeout,
  InsufficientFunds,
  MintRejected,
  MintUnreachable,
  PaymentFailed,
  PaymentPending,
} from "../domain/errors";
import {
  Amount,
  MintUrl,
  NonNegativeAmount,
  OperationId,
  QuoteId,
} from "../domain/primitives";

export class AutoswapDraft extends Schema.Class<AutoswapDraft>("AutoswapDraft")(
  {
    sourceMint: MintUrl,
    targetMint: MintUrl,
    /**
     * What the target mint issues. The source pays it plus the Lightning fee
     * reserve and its cashu input fee. Omitted: sweep the whole balance.
     */
    amount: Schema.optional(Amount),
  },
) {}

/** Upper bound on what moving `amount` costs; nothing was paid for it. */
export class AutoswapEstimate extends Schema.Class<AutoswapEstimate>(
  "AutoswapEstimate",
)({
  sourceMint: MintUrl,
  targetMint: MintUrl,
  /** What the target mint would issue. */
  amount: Amount,
  /** Lightning fee reserve the source mint quoted for the invoice. */
  lightningFeeReserve: NonNegativeAmount,
  /** Cashu input fee allowance over the source's available proofs. */
  inputFee: NonNegativeAmount,
  /** `amount + lightningFeeReserve + inputFee`. */
  totalFromSource: Amount,
}) {}

export class AutoswapReceipt extends Schema.Class<AutoswapReceipt>(
  "AutoswapReceipt",
)({
  sourceMint: MintUrl,
  targetMint: MintUrl,
  /** Amount that arrived at the target mint, stored as `available`. */
  movedAmount: Amount,
  feePaid: NonNegativeAmount,
  /** The `autoswap` operation, now `done`. */
  operationId: OperationId,
}) {}

export class AutoswapClaimResult extends Schema.Class<AutoswapClaimResult>(
  "AutoswapClaimResult",
)({
  quoteId: QuoteId,
  targetMint: MintUrl,
  /**
   * `claimed` — proofs minted and persisted; `not-claimable-yet` — quote
   * unpaid, kept for the next pass; `dropped` — deterministic recovery
   * exhausted, claim closed to avoid retrying forever.
   */
  status: Schema.Literal("claimed", "not-claimable-yet", "dropped"),
  operationId: OperationId,
  amount: Schema.NullOr(Amount),
}) {}

export const AutoswapError = Schema.Union(
  InsufficientFunds,
  MintUnreachable,
  MintRejected,
  PaymentFailed,
  PaymentPending,
  CounterLockTimeout,
);
export type AutoswapError = typeof AutoswapError.Type;

export const AutoswapEstimateError = Schema.Union(
  InsufficientFunds,
  MintUnreachable,
  MintRejected,
);
export type AutoswapEstimateError = typeof AutoswapEstimateError.Type;
