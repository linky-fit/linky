import type {
  EsploraAddressStats,
  EsploraClient,
} from "@linky-fit/onchain-transfer";
import { Duration, Effect, Schedule } from "effect";

/** BIP86 chain 0 receives, chain 1 takes the change of the operator's wallet. */
export type AddressChain = 0 | 1;

/** Unused addresses in a row after which a chain counts as scanned, as wallets do (BIP44's gap limit). */
export const ADDRESS_GAP_LIMIT = 20;
// mempool.space answers 429 to a few lookups at a time already.
const CONCURRENT_LOOKUPS = 2;
const RATE_LIMIT_RETRIES = 5;

const confirmedSatOf = (stats: EsploraAddressStats): number =>
  stats.chain_stats.funded_txo_sum - stats.chain_stats.spent_txo_sum;

const isUsed = (stats: EsploraAddressStats): boolean =>
  stats.chain_stats.tx_count + stats.mempool_stats.tx_count > 0;

/**
 * The confirmed sats of every address of the account up to
 * `ADDRESS_GAP_LIMIT` unused ones past the last used. On the receive chain
 * the gap starts no earlier than `receiveFrom`, the next deposit index,
 * because deposit addresses of transfers nobody paid leave longer gaps. A
 * lookup the server rate-limits is tried again after `retryAfter`, doubling
 * each time; one it never answers counts as unused and empty.
 */
export const scanOnchainWallet = ({
  addressAt,
  receiveFrom,
  esplora,
  retryAfter = Duration.seconds(1),
}: {
  readonly addressAt: (chain: AddressChain, index: number) => string;
  readonly receiveFrom: number;
  readonly esplora: Pick<EsploraClient, "addressStats">;
  readonly retryAfter?: Duration.Duration;
}): Effect.Effect<number> =>
  Effect.gen(function* () {
    let confirmedSat = 0;
    for (const chain of [0, 1] as const) {
      let next = 0;
      let end = (chain === 0 ? receiveFrom : 0) + ADDRESS_GAP_LIMIT;
      while (next < end) {
        const from = next;
        const indexes = Array.from(
          { length: end - from },
          (_, offset) => from + offset,
        );
        next = end;
        const looked = yield* Effect.forEach(
          indexes,
          (index) =>
            esplora.addressStats(addressAt(chain, index)).pipe(
              Effect.retry({
                schedule: Schedule.exponential(retryAfter),
                times: RATE_LIMIT_RETRIES,
                while: (error) => error.status === 429,
              }),
              Effect.map((stats) => ({ index, stats })),
              Effect.orElseSucceed(() => ({ index, stats: null })),
            ),
          { concurrency: CONCURRENT_LOOKUPS },
        );
        for (const { index, stats } of looked) {
          if (stats === null) continue;
          confirmedSat += confirmedSatOf(stats);
          if (isUsed(stats)) end = Math.max(end, index + 1 + ADDRESS_GAP_LIMIT);
        }
      }
    }
    return confirmedSat;
  });
