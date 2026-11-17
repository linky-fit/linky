import {
  EsploraError,
  type EsploraAddressStats,
} from "@linky-fit/onchain-transfer";
import { Duration, Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  ADDRESS_GAP_LIMIT,
  scanOnchainWallet,
  type AddressChain,
} from "./onchainWallet";

const addressAt = (chain: AddressChain, index: number) => `${chain}/${index}`;

const stats = (
  confirmed: readonly [funded: number, spent: number],
  mempool: readonly [funded: number, spent: number] = [0, 0],
): EsploraAddressStats => ({
  chain_stats: {
    funded_txo_sum: confirmed[0],
    spent_txo_sum: confirmed[1],
    tx_count: confirmed[0] > 0 ? 1 : 0,
  },
  mempool_stats: {
    funded_txo_sum: mempool[0],
    spent_txo_sum: mempool[1],
    tx_count: mempool[0] + mempool[1] > 0 ? 1 : 0,
  },
});

const scan = (
  byAddress: Record<string, EsploraAddressStats | "fail">,
  receiveFrom = 0,
) => {
  const asked: string[] = [];
  const result = Effect.runPromise(
    scanOnchainWallet({
      addressAt,
      receiveFrom,
      esplora: {
        addressStats: (address) =>
          Effect.suspend(() => {
            asked.push(address);
            const answer = byAddress[address] ?? stats([0, 0]);
            return answer === "fail"
              ? Effect.fail(new EsploraError({ url: "", message: "offline" }))
              : Effect.succeed(answer);
          }),
      },
    }),
  );
  return { result, asked };
};

describe("scanOnchainWallet", () => {
  it("sums the confirmed sats of receive and change addresses", async () => {
    const { result } = scan({
      "0/0": stats([100_000, 100_000]),
      "0/3": stats([50_000, 0], [0, 50_000]),
      "1/0": stats([40_000, 0]),
      "1/1": stats([0, 0], [7_000, 0]),
    });
    expect(await result).toBe(90_000);
  });

  it("reads each chain until the gap limit past the last used address", async () => {
    const { result, asked } = scan({ "0/15": stats([1_000, 0]) });
    await result;
    expect(asked.filter((a) => a.startsWith("0/"))).toHaveLength(
      16 + ADDRESS_GAP_LIMIT,
    );
    expect(asked.filter((a) => a.startsWith("1/"))).toHaveLength(
      ADDRESS_GAP_LIMIT,
    );
  });

  it("starts the receive gap no earlier than the next deposit index", async () => {
    const { result, asked } = scan({ "0/60": stats([1_000, 0]) }, 50);
    expect(await result).toBe(1_000);
    expect(asked.filter((a) => a.startsWith("0/"))).toHaveLength(
      61 + ADDRESS_GAP_LIMIT,
    );
  });

  it("tries a rate-limited lookup again", async () => {
    let calls = 0;
    const balance = await Effect.runPromise(
      scanOnchainWallet({
        addressAt,
        receiveFrom: 0,
        retryAfter: Duration.millis(1),
        esplora: {
          addressStats: (address) =>
            Effect.suspend(() => {
              calls += 1;
              return calls <= 2
                ? Effect.fail(
                    new EsploraError({
                      url: "",
                      status: 429,
                      message: "slow down",
                    }),
                  )
                : Effect.succeed(
                    address === "0/0" ? stats([5_000, 0]) : stats([0, 0]),
                  );
            }),
        },
      }),
    );
    expect(balance).toBe(5_000);
  });

  it("sums what the server answered for and leaves out the rest", async () => {
    const { result } = scan({ "0/0": "fail", "0/1": stats([2_000, 0]) });
    expect(await result).toBe(2_000);
  });
});
