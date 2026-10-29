import { appMessageChannel } from "@linky-fit/linkstr";
import { Option, Schema, Struct } from "effect";
import {
  ONCHAIN_TRANSFER_APP_NAMESPACE,
  OnchainTransferDirection,
} from "./constants";
import {
  BasisPoints,
  NonEmptyText,
  NonNegativeInt,
  PositiveInt,
  OnchainTransferIdString,
} from "./schema";
import { OperatorTransferStatus } from "./status";

// Messages written by any release must keep validating here: add optional fields only, never rename.

/** Bech32 addresses are at most 90 characters. */
const BitcoinAddressText = NonEmptyText(100);
/** Fits the 1000-character Evolu columns the requests are stored in. */
const PaymentRequestText = NonEmptyText(1000);
const Txid = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/));

export const OnchainTransferRefund = Schema.Union([
  Schema.Struct({ to: Schema.Literal("address"), address: BitcoinAddressText }),
  Schema.Struct({ to: Schema.Literal("sender") }),
]);
export type OnchainTransferRefund = typeof OnchainTransferRefund.Type;

const hasDirectionFields = (request: {
  readonly direction: OnchainTransferDirection;
  readonly amount?: number;
  readonly payoutAddress?: string;
  readonly refund?: OnchainTransferRefund;
  readonly paymentRequest?: string;
}): boolean =>
  request.direction === "send"
    ? request.amount !== undefined && request.payoutAddress !== undefined
    : request.refund !== undefined && request.paymentRequest !== undefined;

/** User to operator: asks for a transfer at the fee the user saw. */
export const OnchainTransferRequest = Schema.Struct({
  v: Schema.Literal(1),
  type: Schema.Literal("request"),
  transferId: OnchainTransferIdString,
  direction: OnchainTransferDirection,
  /**
   * Sats the user gets; they send it plus the fee. Absent only on an on-chain
   * receive of any amount, whose deposit sets it (`depositTerms`); its
   * `paymentRequest` names no amount either.
   */
  amount: Schema.optionalKey(PositiveInt),
  feeBasisPoints: BasisPoints,
  /** send: where the operator pays. */
  payoutAddress: Schema.optionalKey(BitcoinAddressText),
  /** receive: where the operator returns a deposit it cannot complete. */
  refund: Schema.optionalKey(OnchainTransferRefund),
  /** receive: the user's NUT-18 request for `amount`, id = transferId. */
  paymentRequest: Schema.optionalKey(PaymentRequestText),
}).check(
  Schema.makeFilter(hasDirectionFields, {
    expected:
      "amount and payoutAddress for send, refund and paymentRequest for receive",
  }),
);
export type OnchainTransferRequest = typeof OnchainTransferRequest.Type;

/** User to operator: withdraws a transfer no funds moved for yet. */
export const OnchainTransferCancel = Schema.Struct({
  v: Schema.Literal(1),
  type: Schema.Literal("cancel"),
  transferId: OnchainTransferIdString,
});
export type OnchainTransferCancel = typeof OnchainTransferCancel.Type;

/** Operator to user: the transfer's whole current state, numbered by `revision`. */
export const OnchainTransferUpdate = Schema.Struct({
  v: Schema.Literal(1),
  type: Schema.Literal("update"),
  transferId: OnchainTransferIdString,
  /** Strictly increasing per transfer; the highest one received wins. */
  revision: PositiveInt,
  status: OperatorTransferStatus,
  /** Locked when the operator accepted; on a receive of any amount the minimum's until the deposit sets them. */
  fee: NonNegativeInt,
  /** The amount plus the fee: what the user sends. `sendAmount - fee` is what the user gets. */
  sendAmount: PositiveInt,
  /** receive, from `accepted` on. */
  depositAddress: Schema.optionalKey(BitcoinAddressText),
  /** send, from `accepted` on: the operator's NUT-18 request for `sendAmount`, id = transferId. */
  paymentRequest: Schema.optionalKey(PaymentRequestText),
  /** The deposit tx for receive, the payout tx for send. */
  txid: Schema.optionalKey(Txid),
  confirmations: Schema.optionalKey(NonNegativeInt),
  receivedAmount: Schema.optionalKey(NonNegativeInt),
  refundTxid: Schema.optionalKey(Txid),
  /** With `refunded`: the sats returned, when the operator could tell. */
  refundAmount: Schema.optionalKey(NonNegativeInt),
  reason: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(500))),
});
export type OnchainTransferUpdate = typeof OnchainTransferUpdate.Type;

export const OnchainTransferMessage = Schema.Union([
  OnchainTransferRequest,
  OnchainTransferCancel,
  OnchainTransferUpdate,
]);
export type OnchainTransferMessage = typeof OnchainTransferMessage.Type;

/** Every transfer message travels as a linkstr app message on this channel. */
export const onchainTransferChannel = appMessageChannel(
  ONCHAIN_TRANSFER_APP_NAMESPACE,
  OnchainTransferMessage,
);

/** The update to keep: a higher revision wins, a replayed or older one changes nothing. */
export const newerTransferUpdate = (
  current: OnchainTransferUpdate | null,
  next: OnchainTransferUpdate,
): OnchainTransferUpdate =>
  current === null || next.revision > current.revision ? next : current;

const UPDATE_COLUMN_MAX_LENGTH = 1000;
const TransferUpdateJson = Schema.fromJsonString(OnchainTransferUpdate);
const StoredTransferUpdateJson = Schema.fromJsonString(
  OnchainTransferUpdate.mapFields(Struct.omit(["paymentRequest"])),
);
const encodeStoredTransferUpdate = Schema.encodeSync(StoredTransferUpdateJson);

/**
 * The stored `updateJson` column: the update without `paymentRequest`, which
 * has its own column. A reason that would push it past 1000 characters
 * (JSON escapes) is shortened.
 */
export const encodeTransferUpdateColumn = (
  update: OnchainTransferUpdate,
): string => {
  let encoded = encodeStoredTransferUpdate(update);
  let reason = update.reason ?? "";
  while (encoded.length > UPDATE_COLUMN_MAX_LENGTH && reason !== "") {
    const excess = encoded.length - UPDATE_COLUMN_MAX_LENGTH;
    reason = reason.slice(0, Math.max(0, reason.length - excess));
    encoded = encodeStoredTransferUpdate({ ...update, reason });
  }
  return encoded;
};

/** The update an `updateJson` column holds, or null when it is empty or unreadable. */
export const decodeTransferUpdateColumn = (
  column: string | null,
): OnchainTransferUpdate | null =>
  column === null
    ? null
    : Option.getOrNull(Schema.decodeUnknownOption(TransferUpdateJson)(column));
