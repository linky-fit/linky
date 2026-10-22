import type {
  OnchainTransferRow,
  OnchainTransfersRepository,
} from "@linky-fit/linksync";
import type { AppMessageReceived, Pubkey } from "@linky-fit/linkstr";
import type { OnchainTransferUpdate } from "@linky-fit/onchain-transfer";
import { Effect } from "effect";
import { reportAppLog } from "../../../devtools/inspector/appLog";
import { operatorTransferUpdate } from "../../lib/onchainOperator";
import { onchainTransferUpdatePatch } from "../../lib/onchainTransfers";
import { NO_WRITE, runWrite, type WriteOutcome } from "../../lib/storeWrite";

export interface OnchainTransferInboxContext {
  /** Null when this build knows no on-chain operator. */
  readonly operator: Pubkey | null;
  readonly transfers: OnchainTransfersRepository;
  /** Runs once a newer update was stored, e.g. to tell the user. */
  readonly onUpdated?: (
    update: OnchainTransferUpdate,
    transfer: OnchainTransferRow,
  ) => void;
}

const reportUpdateReceived = (
  event: AppMessageReceived,
  update: OnchainTransferUpdate,
): void =>
  reportAppLog({
    tag: "onchainTransfer.updateReceived",
    summary: `On-chain operator moved the transfer to ${update.status} (revision ${update.revision})`,
    links: {
      onchainTransfer: update.transferId,
      paymentRequest: update.transferId,
      rumor: event.messageId,
    },
    payload: {
      status: update.status,
      revision: update.revision,
      fee: update.fee,
      sendAmount: update.sendAmount,
      txid: update.txid ?? null,
      confirmations: update.confirmations ?? null,
      receivedAmount: update.receivedAmount ?? null,
      refundTxid: update.refundTxid ?? null,
      reason: update.reason ?? null,
    },
  });

/**
 * Applies the on-chain operator's update to the user's transfer it names. Only the
 * operator is trusted, only for a transfer held with it as the peer, and only a
 * newer revision changes the row, so inbox replays write nothing.
 */
export const applyOnchainTransferAppMessage = (
  event: AppMessageReceived,
  { operator, transfers, onUpdated }: OnchainTransferInboxContext,
): Promise<WriteOutcome> => {
  const update = operatorTransferUpdate(event, operator);
  if (operator === null || update === null) return NO_WRITE;
  return runWrite(
    Effect.flatMap(transfers.byId(update.transferId), (row) => {
      const patch = row && onchainTransferUpdatePatch(row, operator, update);
      if (!row || !patch) return Effect.void;
      return transfers.update(update.transferId, patch).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            reportUpdateReceived(event, update);
            onUpdated?.(update, row);
          }),
        ),
      );
    }),
  );
};
