import type { OnchainTransferId } from "@linky-fit/linksync";
import { findPayout, type EsploraClient } from "@linky-fit/onchain-transfer";
import { Effect, Result } from "effect";
import type { OnchainTransferView } from "./onchainTransfers";

/** send: paid, yet without an outcome from the operator, who may have settled it by hand without telling. */
export const isAwaitingPayout = (
  transfer: Pick<OnchainTransferView, "direction" | "phase" | "payoutAddress">,
): boolean =>
  transfer.direction === "send" &&
  transfer.phase === "sent" &&
  transfer.payoutAddress !== null;

export type PayoutCheck =
  | { readonly _tag: "found"; readonly txid: string }
  | { readonly _tag: "notFound" }
  | { readonly _tag: "failed"; readonly message: string };

export interface TransferPayoutCheck {
  readonly id: OnchainTransferId;
  readonly check: PayoutCheck;
}

/**
 * Looks on chain for the payout of every send awaiting one, oldest first, so
 * two sends to one address of one amount take its payouts in order; a payout
 * already settling another transfer is never taken again.
 */
export const checkOnchainPayouts = (
  transfers: readonly OnchainTransferView[],
  esplora: EsploraClient,
): Effect.Effect<ReadonlyArray<TransferPayoutCheck>> =>
  Effect.gen(function* () {
    const claimed = new Set(
      transfers.flatMap((transfer) =>
        transfer.direction === "send"
          ? [transfer.update?.txid, transfer.foundPayoutTxid].filter(
              (txid) => txid != null,
            )
          : [],
      ),
    );
    const awaiting = transfers
      .filter(isAwaitingPayout)
      .sort((a, b) => a.createdAtSec - b.createdAtSec);
    const checks: TransferPayoutCheck[] = [];
    for (const transfer of awaiting) {
      if (transfer.payoutAddress === null) continue;
      const transactions = yield* Effect.result(
        esplora.addressTransactions(transfer.payoutAddress),
      );
      if (Result.isFailure(transactions)) {
        checks.push({
          id: transfer.id,
          check: { _tag: "failed", message: transactions.failure.message },
        });
        continue;
      }
      const txid = findPayout({
        transactions: transactions.success,
        payoutAddress: transfer.payoutAddress,
        amount: transfer.amount,
        notBeforeSec: transfer.createdAtSec,
        claimedTxids: claimed,
      });
      if (txid !== null) claimed.add(txid);
      checks.push({
        id: transfer.id,
        check: txid === null ? { _tag: "notFound" } : { _tag: "found", txid },
      });
    }
    return checks;
  });
