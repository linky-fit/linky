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
  },
) {}

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
