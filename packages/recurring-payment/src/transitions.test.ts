import { describe, expect, it } from "vitest";
import {
  readRecurringPaymentOrder,
  recurringProgressColumn,
  type RecurringPaymentColumns,
  type RecurringProgress,
} from "./order";
import {
  DUE,
  HOUR,
  MINT,
  recurringColumnsFixture,
  recurringOrderFixture,
} from "./testing/orders";
import { planRecurringPaymentTick, runNowAction } from "./tick";
import {
  editPatch,
  resumePatch,
  runFailedPatch,
  runPaidPatch,
  runSkippedPatch,
  type RecurringPaymentPatch,
} from "./transitions";

const order = recurringOrderFixture({
  schedule: { ...recurringOrderFixture().schedule, runCount: 2 },
});
const run = { order, runIndex: 2, dueAtSec: DUE };

const progress = (runCount: number, nextDueAtSec: number) =>
  recurringProgressColumn({ runCount, nextDueAtSec });

describe("transitions", () => {
  describe("runPaidPatch", () => {
    it("counts the run and moves to the first due time after now", () => {
      expect(runPaidPatch(run, DUE + 7 * HOUR)).toEqual({
        lastRunAtSec: DUE + 7 * HOUR,
        lastRunStatus: "paid",
        progress: progress(3, DUE + 12 * HOUR),
      });
    });

    it("consumes a pending period paid before its due time", () => {
      const early = runNowAction(
        recurringOrderFixture({
          schedule: {
            ...recurringOrderFixture().schedule,
            nextDueAtSec: DUE + 6 * HOUR,
            runCount: 1,
          },
        }),
        100,
      );
      expect(runPaidPatch(early, DUE + HOUR).progress).toBe(
        progress(2, DUE + 12 * HOUR),
      );
    });

    it("writes the same count when another device already counted the run", () => {
      const counted = {
        ...run,
        order: recurringOrderFixture({
          schedule: { ...order.schedule, runCount: 3 },
        }),
      };
      expect(runPaidPatch(counted, DUE + HOUR).progress).toBe(
        progress(3, DUE + 6 * HOUR),
      );
    });
  });

  it("leaves a failed run due with its number", () => {
    expect(runFailedPatch(DUE + 5)).toEqual({
      lastRunAtSec: DUE + 5,
      lastRunStatus: "failed",
    });
  });

  it("skips the period without counting a run", () => {
    expect(runSkippedPatch(run, DUE + 6 * HOUR)).toEqual({
      lastRunAtSec: DUE + 6 * HOUR,
      lastRunStatus: "skipped",
      progress: progress(2, DUE + 12 * HOUR),
    });
  });

  it("resumes on the next future due time, never a passed one", () => {
    const paused = recurringOrderFixture({
      schedule: { ...order.schedule, pausedAtSec: DUE - 1 },
    });
    expect(resumePatch(paused, DUE - HOUR)).toEqual({
      pausedAtSec: null,
      progress: progress(2, DUE),
    });
    expect(resumePatch(paused, DUE + HOUR)).toEqual({
      pausedAtSec: null,
      progress: progress(2, DUE + 6 * HOUR),
    });
  });

  it("starts an edited schedule at its new first due time", () => {
    expect(editPatch(order, DUE + 3 * HOUR)).toEqual({
      progress: progress(2, DUE + 3 * HOUR),
    });
  });
});

/** Every row column-wise last-writer-wins can leave: each column from the base or any patch that wrote it. */
const mergedRows = (
  base: RecurringPaymentColumns,
  patches: ReadonlyArray<RecurringPaymentPatch>,
): RecurringPaymentColumns[] =>
  patches
    .flatMap((patch) => Object.entries(patch))
    .reduce<
      RecurringPaymentColumns[]
    >((rows, [column, value]) => rows.flatMap((row) => [row, { ...row, [column]: value }]), [base]);

const progressOf = (row: RecurringPaymentColumns): RecurringProgress => {
  const read = readRecurringPaymentOrder(row);
  if (read === null) throw new Error("unreadable row");
  return {
    runCount: read.schedule.runCount,
    nextDueAtSec: read.schedule.nextDueAtSec,
  };
};

describe("progress under last-writer-wins sync", () => {
  const base = recurringColumnsFixture();
  const stale = recurringOrderFixture();
  const paid = runPaidPatch({ order: stale, runIndex: 0, dueAtSec: DUE }, DUE);

  it("never plans the next run for a period the paid run settled", () => {
    for (const row of mergedRows(base, [paid])) {
      const merged = readRecurringPaymentOrder(row);
      if (merged === null) throw new Error("unreadable row");
      const runs = planRecurringPaymentTick({
        orders: [merged],
        nowSec: DUE + 120,
        balanceSatByMint: new Map([[MINT, 1_000]]),
        fiatRates: null,
        fundedEnvelopeSat: new Map(),
        retryNotBeforeSec: new Map(),
      }).filter((action) => action.kind === "run");
      for (const action of runs) {
        expect([action.runIndex, action.dueAtSec]).toEqual([0, DUE]);
      }
    }
  });

  it("leaves a count and due time that one write made together", () => {
    const writes = [
      paid,
      runSkippedPatch({ order: stale, dueAtSec: DUE }, DUE + 6 * HOUR),
      editPatch(stale, DUE + 3 * HOUR),
      resumePatch(stale, DUE + 7 * HOUR),
    ];
    const written = [
      base,
      ...writes.map((patch) => ({ ...base, ...patch })),
    ].map(progressOf);
    for (const [index, first] of writes.entries()) {
      for (const second of writes.slice(index + 1)) {
        for (const row of mergedRows(base, [first, second])) {
          expect(written).toContainEqual(progressOf(row));
        }
      }
    }
  });
});
