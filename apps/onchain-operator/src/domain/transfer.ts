import type { OnchainTransferId } from "@linky-fit/domain";
import { decodePaymentRequest, type OperationId } from "@linky-fit/linkshu";
import type { Pubkey } from "@linky-fit/linkstr";
import {
  isTerminalStatus,
  serviceFee,
  amountWithServiceFee,
  type OperatorTransferStatus,
  type OnchainTransferDirection,
  type OnchainTransferRefund,
  type OnchainTransferUpdate,
} from "@linky-fit/onchain-transfer";

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
}

/** `null` while the transfer waits for the operator to accept or deny it. */
export const transferStatus = (
  transfer: OperatorTransfer,
): OperatorTransferStatus | null => transfer.update?.status ?? null;

export const isOpen = (transfer: OperatorTransfer): boolean => {
  const status = transferStatus(transfer);
  return status === null || !isTerminalStatus(status);
};

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

/** Open transfers first, the oldest on top since it waits longest; then the rest, newest first. */
export const sortTransfers = (
  transfers: readonly OperatorTransfer[],
): {
  readonly open: readonly OperatorTransfer[];
  readonly closed: readonly OperatorTransfer[];
} => ({
  open: transfers
    .filter(isOpen)
    .sort((a, b) => a.createdAtSec - b.createdAtSec),
  closed: transfers
    .filter((transfer) => !isOpen(transfer))
    .sort((a, b) => b.createdAtSec - a.createdAtSec),
});
