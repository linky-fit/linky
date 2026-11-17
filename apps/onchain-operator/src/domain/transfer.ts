import type { OnchainTransferId } from "@linky-fit/domain";
import { decodePaymentRequest, type OperationId } from "@linky-fit/linkshu";
import type { Pubkey } from "@linky-fit/linkstr";
import {
  serviceFee,
  amountWithServiceFee,
  type OperatorTransferStatus,
  type OnchainTransferDirection,
  type OnchainTransferRefund,
  type OnchainTransferUpdate,
} from "@linky-fit/onchain-transfer";

/** The outcome the operator closed a transfer with by hand, after settling it outside the protocol. */
export const closedByHandOutcomes = ["completed", "cancelled"] as const;
export type ClosedByHand = (typeof closedByHandOutcomes)[number];

/** One on-chain transfer as the on-chain operator holds it. */
export interface OperatorTransfer {
  readonly id: OnchainTransferId;
  readonly createdAtSec: number;
  /** The Linky user who requested it. */
  readonly user: Pubkey;
  readonly direction: OnchainTransferDirection;
  /** Sats the user gets; they send it plus the fee. */
  readonly amount: number;
  /** The fee the user requested the transfer at. */
  readonly feeBasisPoints: number;
  /** send: where the operator pays. */
  readonly payoutAddress: string | null;
  /** receive: where a deposit that cannot complete goes back. */
  readonly refund: OnchainTransferRefund | null;
  /** receive: the user's NUT-18 request the operator pays. */
  readonly userPaymentRequest: string | null;
  /** send: the operator's NUT-18 request the user pays. */
  readonly operatorPaymentRequest: string | null;
  readonly depositAddress: string | null;
  readonly addressIndex: number | null;
  /** The wallet send carrying the transfer's Cashu while it is on its way, as any device of the operator sees it. */
  readonly ecashSendId: OperationId | null;
  /** The newest update the operator sent; `null` before accepting or denying. */
  readonly update: OnchainTransferUpdate | null;
  /** When the user asked to cancel; a transfer whose funds moved stays open. */
  readonly userCancelledAtSec: number | null;
  /** Set when the operator closed the transfer by hand; it then gets no more updates and the user is not told. */
  readonly closedByHand: ClosedByHand | null;
  /** A test transfer, hidden in the console and left out of the stats. */
  readonly isTest: boolean;
}

/** `null` while the transfer waits for the operator to accept or deny it. */
export const transferStatus = (
  transfer: OperatorTransfer,
): OperatorTransferStatus | null => transfer.update?.status ?? null;

export type TransferOutcome =
  | "completed"
  | "open"
  | "refunded"
  | "cancelled"
  | "denied";

/** How the transfer ended, the outcome it was closed with by hand first; `open` while it runs. */
export const transferOutcome = (
  transfer: OperatorTransfer,
): TransferOutcome => {
  if (transfer.closedByHand !== null) return transfer.closedByHand;
  const status = transferStatus(transfer);
  switch (status) {
    case "completed":
    case "refunded":
    case "cancelled":
    case "denied":
      return status;
    default:
      return "open";
  }
};

export const isOpen = (transfer: OperatorTransfer): boolean =>
  transferOutcome(transfer) === "open";

/** The terms of a transfer: what the user gets, the fee and what they send. */
export interface TransferTerms {
  /** Sats the user gets. */
  readonly amount: number;
  readonly fee: number;
  /** The amount plus the fee. */
  readonly sendAmount: number;
}

/**
 * The terms: from the requested fee before the first update, locked by it
 * after, and on a receive of any amount set by the deposit from `fundsSeen`
 * on (`sendAmount - fee` is what the user gets).
 */
export const transferTerms = (transfer: OperatorTransfer): TransferTerms =>
  transfer.update === null
    ? {
        amount: transfer.amount,
        fee: serviceFee(transfer.amount, transfer.feeBasisPoints),
        sendAmount: amountWithServiceFee(
          transfer.amount,
          transfer.feeBasisPoints,
        ),
      }
    : {
        amount: transfer.update.sendAmount - transfer.update.fee,
        fee: transfer.update.fee,
        sendAmount: transfer.update.sendAmount,
      };

/** An on-chain receive whose user left the amount to the deposit: its payment request names none. */
export const isAnyAmountReceive = (transfer: OperatorTransfer): boolean =>
  transfer.direction === "receive" &&
  transfer.userPaymentRequest !== null &&
  decodePaymentRequest(transfer.userPaymentRequest)?.amount === null;

/** Open transfers first, the oldest on top since it waits longest; then the rest, newest first; cancelled and test transfers apart, newest first. */
export const sortTransfers = (
  transfers: readonly OperatorTransfer[],
): {
  readonly open: readonly OperatorTransfer[];
  readonly closed: readonly OperatorTransfer[];
  readonly cancelled: readonly OperatorTransfer[];
  readonly tests: readonly OperatorTransfer[];
} => {
  const real = transfers.filter((transfer) => !transfer.isTest);
  const newestFirst = (a: OperatorTransfer, b: OperatorTransfer) =>
    b.createdAtSec - a.createdAtSec;
  const isCancelled = (transfer: OperatorTransfer) =>
    transferOutcome(transfer) === "cancelled";
  return {
    open: real.filter(isOpen).sort((a, b) => a.createdAtSec - b.createdAtSec),
    closed: real
      .filter((transfer) => !isOpen(transfer) && !isCancelled(transfer))
      .sort(newestFirst),
    cancelled: real.filter(isCancelled).sort(newestFirst),
    tests: transfers.filter((transfer) => transfer.isTest).sort(newestFirst),
  };
};

/**
 * Whose move an open transfer waits for and over which rail: `review` for a
 * request the operator has not answered; a user who cancelled after paying
 * gets their funds back over the rail they paid on.
 */
export type TransferWait =
  | "review"
  | "userCashu"
  | "userOnchain"
  | "operatorCashu"
  | "operatorOnchain";

export const transferWait = (
  transfer: OperatorTransfer,
): TransferWait | null => {
  if (!isOpen(transfer)) return null;
  const status = transferStatus(transfer);
  if (status === null) return "review";
  const cancelled = transfer.userCancelledAtSec !== null;
  if (transfer.direction === "send")
    return status === "fundsReceived"
      ? cancelled
        ? "operatorCashu"
        : "operatorOnchain"
      : "userCashu";
  if (status === "fundsReceived")
    return cancelled ? "operatorOnchain" : "operatorCashu";
  return status === "fundsSeen" && cancelled
    ? "operatorOnchain"
    : "userOnchain";
};

/** Whether a deposit reached the transfer's deposit address, as its last update tells. */
const depositArrived = (transfer: OperatorTransfer): boolean =>
  transfer.update?.txid !== undefined ||
  (transfer.update?.receivedAmount ?? 0) > 0;

/** A deposit address handed to a user that no deposit reached, with the newest transfer holding it. */
export interface ReservedDepositAddress {
  readonly address: string;
  readonly addressIndex: number;
  readonly transfer: OperatorTransfer;
}

/**
 * The deposit addresses of `user`'s closed on-chain receives that no deposit
 * reached, newest first: no open transfer watches them, yet the user may still
 * pay one, and their next on-chain receive gets the newest again.
 */
export const reservedDepositAddresses = (
  transfers: readonly OperatorTransfer[],
  user: Pubkey,
): ReservedDepositAddress[] => {
  const holders = new Map<string, OperatorTransfer[]>();
  for (const transfer of transfers)
    if (transfer.direction === "receive" && transfer.depositAddress !== null)
      holders.set(transfer.depositAddress, [
        ...(holders.get(transfer.depositAddress) ?? []),
        transfer,
      ]);
  return [...holders.entries()]
    .flatMap(([address, held]): ReservedDepositAddress[] => {
      const newest = held.reduce((a, b) =>
        b.createdAtSec > a.createdAtSec ? b : a,
      );
      return newest.user === user &&
        newest.addressIndex !== null &&
        !isOpen(newest) &&
        !held.some(depositArrived)
        ? [{ address, addressIndex: newest.addressIndex, transfer: newest }]
        : [];
    })
    .sort((a, b) => b.transfer.createdAtSec - a.transfer.createdAtSec);
};

/** An on-chain receive whose amount the user has yet to set by depositing. */
export const isAmountUnknown = (transfer: OperatorTransfer): boolean =>
  isAnyAmountReceive(transfer) && !depositArrived(transfer);
