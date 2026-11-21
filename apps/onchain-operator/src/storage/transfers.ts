import type { OnchainTransferId } from "@linky-fit/domain";
import { OperationId } from "@linky-fit/linkshu";
import { Pubkey } from "@linky-fit/linkstr";
import type {
  OnchainTransferRecord,
  OnchainTransfersRepository,
  RowNotFound,
  ShardDbError,
} from "@linky-fit/linksync";
import {
  decodeTransferUpdateColumn,
  encodeTransferUpdateColumn,
  OnchainTransferDirection,
  type OnchainTransferRefund,
  type OnchainTransferRequest,
  type OnchainTransferUpdate,
} from "@linky-fit/onchain-transfer";
import { Effect, Option, Schema } from "effect";
import {
  closedByHandOutcomes,
  type ClosedByHand,
  type OperatorTransfer,
} from "../domain/transfer";

const OPERATOR = "operator";
const isPubkey = Schema.is(Pubkey);
const isDirection = Schema.is(OnchainTransferDirection);
const isClosedByHand = Schema.is(Schema.Literals(closedByHandOutcomes));

const refundOf = (row: OnchainTransferRecord): OnchainTransferRefund | null =>
  row.refundAddress !== null
    ? { to: "address", address: row.refundAddress }
    : row.refundToSender === true
      ? { to: "sender" }
      : null;

/** The transfer a row holds; `null` for the user's own rows and rows this release cannot read. */
export const toOperatorTransfer = (
  row: OnchainTransferRecord,
): OperatorTransfer | null =>
  row.role === OPERATOR &&
  isPubkey(row.peerPubkey) &&
  isDirection(row.direction)
    ? {
        id: row.id,
        createdAtSec: row.createdAtSec,
        user: row.peerPubkey,
        direction: row.direction,
        amount: row.amount,
        feeBasisPoints: row.feeBasisPoints,
        payoutAddress: row.payoutAddress,
        refund: refundOf(row),
        userPaymentRequest: row.userPaymentRequest,
        operatorPaymentRequest: row.operatorPaymentRequest,
        depositAddress: row.depositAddress,
        addressIndex: row.addressIndex,
        ecashSendId: Option.getOrNull(
          Schema.decodeUnknownOption(OperationId)(row.ecashSendId),
        ),
        update: decodeTransferUpdateColumn(row.updateJson),
        userCancelledAtSec: row.cancelledAtSec,
        closedByHand: isClosedByHand(row.closedByHand)
          ? row.closedByHand
          : null,
        isTest: row.isTest === true,
      }
    : null;

export const readTransfers = (
  transfers: OnchainTransfersRepository,
): Effect.Effect<readonly OperatorTransfer[]> =>
  Effect.map(transfers.all, (rows) =>
    rows.flatMap((row) => toOperatorTransfer(row) ?? []),
  );

export const readTransfer = (
  transfers: OnchainTransfersRepository,
  id: OnchainTransferId,
): Effect.Effect<OperatorTransfer | null> =>
  Effect.map(
    readTransfers(transfers),
    (all) => all.find((transfer) => transfer.id === id) ?? null,
  );

/**
 * Stores a request from `user` once per transfer id; `false` when the transfer
 * was already stored. A receive of any amount, which names none, is stored at
 * `fallbackAmount`, the smallest receive, until its deposit sets the terms.
 */
export const insertRequest = (
  transfers: OnchainTransfersRepository,
  request: OnchainTransferRequest,
  user: Pubkey,
  receivedAtSec: number,
  fallbackAmount: number,
): Effect.Effect<boolean, ShardDbError> =>
  transfers.insertIfAbsent({
    id: request.transferId,
    createdAtSec: receivedAtSec,
    role: OPERATOR,
    peerPubkey: user,
    direction: request.direction,
    amount: request.amount ?? fallbackAmount,
    feeBasisPoints: request.feeBasisPoints,
    ...(request.payoutAddress === undefined
      ? {}
      : { payoutAddress: request.payoutAddress }),
    ...(request.refund?.to === "address"
      ? { refundAddress: request.refund.address }
      : request.refund?.to === "sender"
        ? { refundToSender: true }
        : {}),
    ...(request.paymentRequest === undefined
      ? {}
      : { userPaymentRequest: request.paymentRequest }),
  });

/** Stores the update the operator sends, with what accepting a transfer fixes. */
export const saveUpdate = (
  transfers: OnchainTransfersRepository,
  update: OnchainTransferUpdate,
  accepted: {
    readonly operatorPaymentRequest?: string;
    readonly depositAddress?: string;
    readonly addressIndex?: number;
  } = {},
): Effect.Effect<void, ShardDbError | RowNotFound> =>
  transfers.update(update.transferId, {
    updateJson: encodeTransferUpdateColumn(update),
    ...(accepted.operatorPaymentRequest === undefined
      ? {}
      : { operatorPaymentRequest: accepted.operatorPaymentRequest }),
    ...(accepted.depositAddress === undefined
      ? {}
      : { depositAddress: accepted.depositAddress }),
    ...(accepted.addressIndex === undefined
      ? {}
      : { addressIndex: accepted.addressIndex }),
  });

/** Records when the transfer's user asked to cancel it. */
export const markUserCancelled = (
  transfers: OnchainTransfersRepository,
  id: OnchainTransferId,
  atSec: number,
): Effect.Effect<void, ShardDbError | RowNotFound> =>
  transfers.update(id, { cancelledAtSec: atSec });

/** Records the wallet send carrying the transfer's Cashu before its message is queued; `null` once it left or was taken back. */
export const saveEcashSend = (
  transfers: OnchainTransfersRepository,
  id: OnchainTransferId,
  operationId: OperationId | null,
): Effect.Effect<void, ShardDbError | RowNotFound> =>
  transfers.update(id, { ecashSendId: operationId });

/** Records the outcome the operator closed the transfer with by hand; `null` reopens it. */
export const saveClosedByHand = (
  transfers: OnchainTransfersRepository,
  id: OnchainTransferId,
  outcome: ClosedByHand | null,
): Effect.Effect<void, ShardDbError | RowNotFound> =>
  transfers.update(id, { closedByHand: outcome });

/** Marks the transfer a test transfer, or a real one again. */
export const saveIsTest = (
  transfers: OnchainTransfersRepository,
  id: OnchainTransferId,
  isTest: boolean,
): Effect.Effect<void, ShardDbError | RowNotFound> =>
  transfers.update(id, { isTest: isTest ? true : null });
