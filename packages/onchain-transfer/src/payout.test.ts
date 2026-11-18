import type { EsploraTransaction } from "./esplora";
import { findPayout } from "./payout";

const payoutAddress = "bcrt1qpayout";

const tx = (
  txid: string,
  paid: number,
  blockTime: number | null,
): EsploraTransaction => ({
  txid,
  vout: [
    { scriptpubkey_address: payoutAddress, value: paid },
    { scriptpubkey_address: "bcrt1qchange", value: 90_000 },
  ],
  status:
    blockTime === null
      ? { confirmed: false }
      : { confirmed: true, block_height: 100, block_time: blockTime },
});

const find = (
  transactions: ReadonlyArray<EsploraTransaction>,
  claimedTxids: ReadonlySet<string> = new Set(),
) =>
  findPayout({
    transactions,
    payoutAddress,
    amount: 500_000,
    notBeforeSec: 1_000,
    claimedTxids,
  });

describe("findPayout", () => {
  it("finds a mempool or mined transaction paying the address the amount", () => {
    expect(find([tx("mempool", 500_000, null)])).toBe("mempool");
    expect(find([tx("mined", 600_000, 1_200)])).toBe("mined");
  });

  it("ignores a transaction paying less or mined before the transfer", () => {
    expect(find([tx("short", 499_999, null)])).toBeNull();
    expect(find([tx("earlier", 500_000, 999)])).toBeNull();
  });

  it("skips the payouts of other transfers and takes the oldest of the rest", () => {
    const transactions = [
      tx("mempool", 500_000, null),
      tx("newer", 500_000, 1_500),
      tx("older", 500_000, 1_100),
    ];
    expect(find(transactions)).toBe("older");
    expect(find(transactions, new Set(["older"]))).toBe("newer");
    expect(find(transactions, new Set(["older", "newer"]))).toBe("mempool");
  });
});
