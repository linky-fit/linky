import { Schema } from "effect";
import {
  AmountConsumedByFee,
  CounterLockTimeout,
  MintRejected,
  MintUnreachable,
  ReceiveDeferred,
  TokenAlreadyKnown,
  TokenAlreadySpent,
  TokenParseFailed,
} from "../domain/errors";
import {
  Amount,
  CurrencyUnit,
  MintUrl,
  OperationId,
  TokenText,
} from "../domain/primitives";

export class ReceiveDraft extends Schema.Class<ReceiveDraft>("ReceiveDraft")({
  /**
   * Raw scanned/pasted text; the codec extracts the token from bare text,
   * cashu: schemes, URLs, and legacy JSON before receiving it.
   */
  text: Schema.NonEmptyString,
  /**
   * True when nobody asked for this receive (a message replayed on a
   * device, a token found while syncing): a text whose deferred receive was
   * closed (received, discarded with `Tokens.forget`, or failed) is then
   * `TokenAlreadyKnown`, so a discarded token stays discarded on every
   * device that has synced it. An explicit receive takes it in again.
   */
  automatic: Schema.optionalWith(Schema.Boolean, { default: () => false }),
}) {}

export class ReceiveReceipt extends Schema.Class<ReceiveReceipt>(
  "ReceiveReceipt",
)({
  /** The transfer this receive settled: the `receive`, or a returned `send`. */
  operationId: OperationId,
  /** The re-signed (swapped) encoding of the proofs now in the wallet. */
  tokenText: TokenText,
  mint: MintUrl,
  unit: CurrencyUnit,
  amount: Amount,
}) {}

export const ReceiveError = Schema.Union(
  TokenParseFailed,
  TokenAlreadyKnown,
  AmountConsumedByFee,
  TokenAlreadySpent,
  MintUnreachable,
  ReceiveDeferred,
  MintRejected,
  CounterLockTimeout,
);
export type ReceiveError = typeof ReceiveError.Type;

/** What `resumeDeferred` did with one `deferredReceive` operation. */
export class DeferredReceiveResult extends Schema.Class<DeferredReceiveResult>(
  "DeferredReceiveResult",
)({
  /** The `deferredReceive` operation. */
  operationId: OperationId,
  mint: MintUrl,
  unit: CurrencyUnit,
  /** The token's face value, before the mint's input fee. */
  amount: Amount,
  /**
   * `received` — the proofs are in the wallet and the deferral is `done`;
   * `closed` — no `receive` recorded and no proofs received: the deferral
   * closes `done` when the token was already received here or on another
   * device, `failed` when it is spent, eaten by the fee or undecodable, and
   * stays as it was when another pass closed it first;
   * `failed` — the swap failed after its `receive` was recorded: that
   * receive is `failed` with the error and carries the retry, the deferral
   * is `done`;
   * `pending` — the mint still cannot be loaded, refreshed or asked, or
   * another context held the mint's receive lease for 30 s; nothing was
   * written and the deferral waits for the next pass.
   */
  status: Schema.Literal("received", "closed", "failed", "pending"),
  /** Set only for `received`. */
  receipt: Schema.NullOr(ReceiveReceipt),
}) {}
