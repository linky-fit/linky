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
 * Looks on chain for the payouts of the sends to `payoutAddress` awaiting
 * one, oldest first, so two sends to one address of one amount take its
 * payouts in order; a payout already settling another transfer is never
 * taken again.
 */
export const checkOnchainPayouts = (
  transfers: readonly OnchainTransferView[],
  payoutAddress: string,
  esplora: EsploraClient,
): Effect.Effect<ReadonlyArray<TransferPayoutCheck>> =>
  Effect.gen(function* () {
    const awaiting = transfers
      .filter(
        (transfer) =>
          isAwaitingPayout(transfer) &&
          transfer.payoutAddress === payoutAddress,
      )
      .sort((a, b) => a.createdAtSec - b.createdAtSec);
    if (awaiting.length === 0) return [];
    const transactions = yield* Effect.result(
      esplora.addressTransactions(payoutAddress),
    );
    if (Result.isFailure(transactions)) {
      const message = transactions.failure.message;
      return awaiting.map(({ id }) => ({
        id,
        check: { _tag: "failed", message } as const,
      }));
    }
    const claimed = new Set(
      transfers.flatMap((transfer) =>
        transfer.direction === "send"
          ? [transfer.update?.txid, transfer.foundPayoutTxid].filter(
              (txid) => txid != null,
            )
          : [],
      ),
    );
    return awaiting.map(({ id, amount, createdAtSec }) => {
      const txid = findPayout({
        transactions: transactions.success,
        payoutAddress,
        amount,
        notBeforeSec: createdAtSec,
        claimedTxids: claimed,
      });
      if (txid === null) return { id, check: { _tag: "notFound" } as const };
      claimed.add(txid);
      return { id, check: { _tag: "found", txid } as const };
    });
  });
