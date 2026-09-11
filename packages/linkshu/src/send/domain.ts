import { Schema } from "effect";
import {
  CounterLockTimeout,
  InsufficientFunds,
  MintRejected,
  MintUnreachable,
} from "../domain/errors";
import {
  Amount,
  CurrencyUnit,
  MintUrl,
  NonNegativeAmount,
  OperationId,
  TokenText,
} from "../domain/primitives";
import { Proof } from "../token/domain";

export class SendDraft extends Schema.Class<SendDraft>("SendDraft")({
  mint: MintUrl,
  amount: Amount,
  memo: Schema.optional(Schema.NonEmptyString),
  /**
   * Status the produced transfer starts in: `issued` for a token shown to
   * someone (QR/share, watched until claimed), `pending` for a token
   * travelling out through a messenger the caller confirms separately.
   */
  produceAs: Schema.Literal("issued", "pending"),
}) {}

export class SendReceipt extends Schema.Class<SendReceipt>("SendReceipt")({
  /** The `send` transfer holding the produced token, in the drafted status. */
  operationId: OperationId,
  tokenText: TokenText,
  /**
   * The same proofs `tokenText` encodes, with full keyset ids. v4 text
   * shortens v2 keyset ids, so callers that need the proofs themselves
   * (NUT-18 POST transport) take them from here instead of decoding.
   */
  proofs: Schema.Array(Proof),
  mint: MintUrl,
  unit: CurrencyUnit,
  amount: Amount,
  /** Change kept after the swap; persisted as fresh `available` proofs. */
  changeAmount: NonNegativeAmount,
  feePaid: NonNegativeAmount,
}) {}

export const SendError = Schema.Union(
  InsufficientFunds,
  MintUnreachable,
  MintRejected,
  CounterLockTimeout,
);
export type SendError = typeof SendError.Type;
