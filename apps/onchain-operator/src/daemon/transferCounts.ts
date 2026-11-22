import * as fs from "node:fs/promises";
import * as path from "node:path";
import { transferCounts } from "../domain/analytics";
import type { OperatorTransfer } from "../domain/transfer";
import { nowSeconds } from "../utils/time";

export const TRANSFER_COUNTS_FILE = "transfers-24h.json";

const DAY_SEC = 86_400;
const WRITE_INTERVAL_MS = 60_000;

/** Replaces `transfers-24h.json` in `dataDir` with the counts of the transfers requested in the 24 h before `nowSec`. */
export const writeTransferCounts = async (
  dataDir: string,
  transfers: readonly OperatorTransfer[],
  nowSec: number,
): Promise<void> => {
  const file = path.join(dataDir, TRANSFER_COUNTS_FILE);
  const temp = `${file}.tmp`;
  const counts = transferCounts(transfers, (sec) => sec > nowSec - DAY_SEC);
  await fs.writeFile(temp, JSON.stringify(counts));
  await fs.rename(temp, file);
};

/** Writes the counts now and every minute until the returned function stops it; a failed write is only logged. */
export const startTransferCountsWriter = ({
  dataDir,
  loadTransfers,
  onError,
}: {
  readonly dataDir: string;
  readonly loadTransfers: () => Promise<readonly OperatorTransfer[]>;
  readonly onError: (error: unknown) => void;
}): (() => void) => {
  const write = () =>
    loadTransfers()
      .then((transfers) =>
        writeTransferCounts(dataDir, transfers, nowSeconds()),
      )
      .catch(onError);
  void write();
  const timer = setInterval(() => void write(), WRITE_INTERVAL_MS);
  return () => clearInterval(timer);
};
