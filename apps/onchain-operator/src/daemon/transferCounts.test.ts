import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { operatorTransferOf as transferOf } from "../domain/testing/transfers";
import {
  startTransferCountsWriter,
  TRANSFER_COUNTS_FILE,
  writeTransferCounts,
} from "./transferCounts";

const NOW = 1_800_000_000;
const HOUR = 3_600;

describe("writeTransferCounts", () => {
  it("writes the last 24 h of transfers per direction as one line of JSON", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "operator-daemon-"));
    try {
      await writeTransferCounts(
        dir,
        [
          transferOf({
            status: "completed",
            direction: "receive",
            createdAtSec: NOW - HOUR,
          }),
          {
            ...transferOf({
              status: "fundsReceived",
              direction: "receive",
              createdAtSec: NOW - 2 * HOUR,
            }),
            closedByHand: "completed",
          },
          transferOf({
            status: null,
            direction: "receive",
            createdAtSec: NOW - 3 * HOUR,
          }),
          {
            ...transferOf({
              status: "completed",
              direction: "send",
              createdAtSec: NOW - HOUR,
            }),
            closedByHand: "cancelled",
          },
          {
            ...transferOf({ status: "completed", createdAtSec: NOW - HOUR }),
            isTest: true,
          },
          transferOf({ status: "completed", createdAtSec: NOW - 25 * HOUR }),
        ],
        NOW,
      );
      expect(fs.readdirSync(dir)).toEqual([TRANSFER_COUNTS_FILE]);
      expect(
        fs.readFileSync(path.join(dir, TRANSFER_COUNTS_FILE), "utf8"),
      ).toBe(
        '{"receive":{"requests":3,"completed":2},"send":{"requests":1,"completed":0}}',
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("startTransferCountsWriter", () => {
  it("hands a failed write to onError instead of throwing", async () => {
    const onError = vi.fn();
    const stop = startTransferCountsWriter({
      dataDir: path.join(os.tmpdir(), "operator-daemon-missing", "nested"),
      loadTransfers: () => Promise.resolve([]),
      onError,
    });
    stop();
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
  });
});
