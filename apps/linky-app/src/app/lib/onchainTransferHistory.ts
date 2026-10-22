import {
  isFinishedOnchainTransferPhase,
  unfinishedOnchainTransfers,
  type OnchainTransferView,
} from "./onchainTransfers";
import {
  readRequestIdFromDetails,
  type TransactionItem,
} from "./transactionHistory";

export type HistoryEntry =
  | { readonly kind: "transaction"; readonly item: TransactionItem }
  | {
      readonly kind: "onchainTransfer";
      readonly transfer: OnchainTransferView;
    };

const entryTime = (entry: HistoryEntry): number =>
  entry.kind === "transaction"
    ? entry.item.createdAtSec
    : entry.transfer.createdAtSec;

/**
 * The payment history with the user's on-chain transfers: the unfinished ones
 * pinned apart, the finished ones among the transactions at their time, newest
 * first. A settled transaction naming a transfer's id as its NUT-18 request id
 * is that transfer's ecash, paid to or received from the on-chain operator, so
 * the transfer's row stands for it; a pending or failed one stays visible.
 */
export const withOnchainTransfers = (
  transactions: readonly TransactionItem[],
  transfers: readonly OnchainTransferView[],
): {
  readonly pending: readonly OnchainTransferView[];
  readonly entries: readonly HistoryEntry[];
} => {
  const transferIds = new Set<string>(transfers.map(({ id }) => id));
  const entries: HistoryEntry[] = [
    ...transactions
      .filter(
        (item) =>
          item.status !== "ok" ||
          !transferIds.has(readRequestIdFromDetails(item.details) ?? ""),
      )
      .map((item) => ({ kind: "transaction" as const, item })),
    ...transfers
      .filter((transfer) => isFinishedOnchainTransferPhase(transfer.phase))
      .map((transfer) => ({ kind: "onchainTransfer" as const, transfer })),
  ];
  // Stable, so transactions of one second keep their order.
  entries.sort((a, b) => entryTime(b) - entryTime(a));
  return { pending: unfinishedOnchainTransfers(transfers), entries };
};
