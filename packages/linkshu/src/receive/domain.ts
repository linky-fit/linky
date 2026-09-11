import { Schema } from "effect";
import {
  CounterLockTimeout,
  MintRejected,
  MintUnreachable,
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
  TokenAlreadySpent,
  MintUnreachable,
  MintRejected,
  CounterLockTimeout,
);
export type ReceiveError = typeof ReceiveError.Type;
