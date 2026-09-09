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
  QuoteId,
  TokenRowId,
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
  /** Amount that arrived at the target mint, persisted as `accepted`. */
  movedAmount: Amount,
  feePaid: NonNegativeAmount,
  rowId: TokenRowId,
}) {}

export class AutoswapClaimResult extends Schema.Class<AutoswapClaimResult>(
  "AutoswapClaimResult",
)({
  quoteId: QuoteId,
  targetMint: MintUrl,
  /**
   * `claimed` — proofs minted and persisted; `not-claimable-yet` — quote
   * unpaid, kept for the next pass; `dropped` — deterministic recovery
   * exhausted, claim removed to avoid retrying forever.
   */
  status: Schema.Literal("claimed", "not-claimable-yet", "dropped"),
  rowId: Schema.NullOr(TokenRowId),
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
