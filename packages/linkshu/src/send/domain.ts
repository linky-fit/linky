import { Schema } from "effect";
import {
  AmountConsumedByFee,
  CounterLockTimeout,
  InsufficientFunds,
  LockingUnsupported,
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
import { P2pkPubkey } from "../domain/p2pk";
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
  produceAs: Schema.Literals(["issued", "pending"]),
  /**
   * Locks the sent proofs to this key (NUT-11 P2PK): only its secret's
   * holder can receive the token. Build it with `parseP2pkPubkey`.
   */
  lockTo: Schema.optional(P2pkPubkey),
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
  /** The key the sent proofs are locked to; null for a bearer token. */
  lockTo: Schema.NullOr(P2pkPubkey),
  /** Change kept after the swap; persisted as fresh `available` proofs. */
  changeAmount: NonNegativeAmount,
  feePaid: NonNegativeAmount,
}) {}

export const SendError = Schema.Union([
  InsufficientFunds,
  AmountConsumedByFee,
  LockingUnsupported,
  MintUnreachable,
  MintRejected,
  CounterLockTimeout,
]);
export type SendError = typeof SendError.Type;
