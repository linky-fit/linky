import type { ClaimRow, Database } from "./db";
import type { Minter } from "./minter";
import { describeError } from "./responses";

const NEW_QUOTES_PER_TICK = 20;

/** Resumes interrupted mints, mints newly paid v3 quotes and settles username fees. */
export async function runWorkerTick(db: Database, minter: Minter) {
  const advance = async (row: ClaimRow) => {
    try {
      await minter.advance(row);
    } catch (error) {
      console.warn(
        `[npubcash-v1] ${row.status} claim ${row.quote_id} at ${row.mint_url}: ${describeError(error)}`,
      );
    }
  };

  for (const row of await db.claimsWithStatus("minting")) await advance(row);

  for (const quote of await db.unclaimedPaidQuotes(NEW_QUOTES_PER_TICK)) {
    try {
      await minter.startClaim(quote);
    } catch (error) {
      console.warn(
        `[npubcash-v1] paid quote ${quote.quote_id} at ${quote.mint_url}: ${describeError(error)}`,
      );
    }
  }

  for (const row of await db.claimsWithStatus("unpaid")) await advance(row);
}

export function startWorker(
  db: Database,
  minter: Minter,
  intervalMs: number,
): { stop: () => Promise<void> } {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> = Promise.resolve();

  const loop = () => {
    running = runWorkerTick(db, minter)
      .catch((error: unknown) => {
        console.error(`[npubcash-v1] worker tick: ${describeError(error)}`);
      })
      .finally(() => {
        if (!stopped) timer = setTimeout(loop, intervalMs);
      });
  };
  loop();

  return {
    stop: async () => {
      stopped = true;
      clearTimeout(timer);
      await running;
    },
  };
}
