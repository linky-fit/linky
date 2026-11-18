import { paysAddress, type EsploraTransaction } from "./esplora";

/**
 * send: the transaction that pays an on-chain send's payout, found on chain
 * without the operator's `completed`: the oldest one paying `payoutAddress` at
 * least `amount`, still unconfirmed or mined at `notBeforeSec` or later, that
 * is not in `claimedTxids` (the payouts of the user's other transfers). Null
 * when none does.
 */
export const findPayout = (args: {
  readonly transactions: ReadonlyArray<EsploraTransaction>;
  readonly payoutAddress: string;
  readonly amount: number;
  readonly notBeforeSec: number;
  readonly claimedTxids: ReadonlySet<string>;
}): string | null => {
  const candidates = args.transactions.filter(
    (tx) =>
      !args.claimedTxids.has(tx.txid) &&
      (!tx.status.confirmed ||
        (tx.status.block_time ?? 0) >= args.notBeforeSec) &&
      paysAddress(tx, args.payoutAddress) >= args.amount,
  );
  const oldestFirst = [...candidates].sort(
    (a, b) =>
      (a.status.block_time ?? Number.MAX_SAFE_INTEGER) -
      (b.status.block_time ?? Number.MAX_SAFE_INTEGER),
  );
  return oldestFirst[0]?.txid ?? null;
};
