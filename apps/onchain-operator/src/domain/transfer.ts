import type { OnchainTransferId } from "@linky-fit/domain";
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

/** The fee and what the user sends: locked by the first update, from the requested fee before. */
export const transferTerms = (
  transfer: OperatorTransfer,
): { readonly fee: number; readonly sendAmount: number } =>
  transfer.update === null
    ? {
        fee: serviceFee(transfer.amount, transfer.feeBasisPoints),
        sendAmount: amountWithServiceFee(
          transfer.amount,
          transfer.feeBasisPoints,
        ),
      }
    : { fee: transfer.update.fee, sendAmount: transfer.update.sendAmount };

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
