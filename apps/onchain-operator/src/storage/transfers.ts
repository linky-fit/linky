import type { OnchainTransferId } from "@linky-fit/domain";
import { OperationId } from "@linky-fit/linkshu";
import { Pubkey } from "@linky-fit/linkstr";
import {
  NonEmptyString100,
  NonEmptyString1000,
  NonNegativeInt,
  PositiveInt,
  sqliteTrue,
  type OnchainTransferRecord,
  type OnchainTransfersRepository,
  type RowNotFound,
  type ShardDbError,
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
import type { OperatorTransfer } from "../domain/transfer";

const OPERATOR = "operator";
const isPubkey = Schema.is(Pubkey);
const isDirection = Schema.is(OnchainTransferDirection);

const refundOf = (row: OnchainTransferRecord): OnchainTransferRefund | null =>
  row.refundAddress !== null
    ? { to: "address", address: row.refundAddress }
    : row.refundToSender === sqliteTrue
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

/** Stores a request from `user` once per transfer id; `false` when the transfer was already stored. */
export const insertRequest = (
  transfers: OnchainTransfersRepository,
  request: OnchainTransferRequest,
  user: Pubkey,
  receivedAtSec: number,
): Effect.Effect<boolean, ShardDbError> =>
  transfers.insertIfAbsent({
    id: request.transferId,
    createdAtSec: PositiveInt.orThrow(receivedAtSec),
    role: NonEmptyString100.orThrow(OPERATOR),
    peerPubkey: NonEmptyString100.orThrow(user),
    direction: NonEmptyString100.orThrow(request.direction),
    amount: PositiveInt.orThrow(request.amount),
    feeBasisPoints: NonNegativeInt.orThrow(request.feeBasisPoints),
    ...(request.payoutAddress === undefined
      ? {}
      : { payoutAddress: NonEmptyString1000.orThrow(request.payoutAddress) }),
    ...(request.refund?.to === "address"
      ? { refundAddress: NonEmptyString1000.orThrow(request.refund.address) }
      : request.refund?.to === "sender"
        ? { refundToSender: sqliteTrue }
        : {}),
    ...(request.paymentRequest === undefined
      ? {}
      : {
          userPaymentRequest: NonEmptyString1000.orThrow(
            request.paymentRequest,
          ),
        }),
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
    updateJson: NonEmptyString1000.orThrow(encodeTransferUpdateColumn(update)),
    ...(accepted.operatorPaymentRequest === undefined
      ? {}
      : {
          operatorPaymentRequest: NonEmptyString1000.orThrow(
            accepted.operatorPaymentRequest,
          ),
        }),
    ...(accepted.depositAddress === undefined
      ? {}
      : {
          depositAddress: NonEmptyString1000.orThrow(accepted.depositAddress),
        }),
    ...(accepted.addressIndex === undefined
      ? {}
      : { addressIndex: NonNegativeInt.orThrow(accepted.addressIndex) }),
  });

/** Records when the transfer's user asked to cancel it. */
export const markUserCancelled = (
  transfers: OnchainTransfersRepository,
  id: OnchainTransferId,
  atSec: number,
): Effect.Effect<void, ShardDbError | RowNotFound> =>
  transfers.update(id, { cancelledAtSec: PositiveInt.orThrow(atSec) });

/** Records the wallet send carrying the transfer's Cashu before its message is queued; `null` once it left or was taken back. */
export const saveEcashSend = (
  transfers: OnchainTransfersRepository,
  id: OnchainTransferId,
  operationId: OperationId | null,
): Effect.Effect<void, ShardDbError | RowNotFound> =>
  transfers.update(id, {
    ecashSendId:
      operationId === null ? null : NonEmptyString100.orThrow(operationId),
  });
