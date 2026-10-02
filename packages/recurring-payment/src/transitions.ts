import {
  recurringProgressColumn,
  type RecurringPaymentOrder,
  type RecurringPaymentRunStatus,
} from "./order";
import { nextDueAfter } from "./schedule";
import type { RecurringRun } from "./tick";

/** The columns one state change writes; the app brands them for its store. */
export interface RecurringPaymentPatch {
  claimAtSec?: number | null;
  claimDeviceId?: string | null;
  claimDueAtSec?: number | null;
  lastRunAtSec?: number | null;
  lastRunStatus?: RecurringPaymentRunStatus;
  pausedAtSec?: number | null;
  /** `recurringProgressColumn` text: the run count and due time, always written together. */
  progress?: string;
}

/** Moves the due time and keeps the count the order was read with. */
const movedDuePatch = (
  order: RecurringPaymentOrder,
  nextDueAtSec: number,
): RecurringPaymentPatch => ({
  progress: recurringProgressColumn({
    runCount: order.schedule.runCount,
    nextDueAtSec,
  }),
});

/** This device shows the countdown for the due time and notifies the user. */
export const claimPatch = (
  deviceId: string,
  nowSec: number,
  dueAtSec: number,
): RecurringPaymentPatch => ({
  claimDeviceId: deviceId,
  claimAtSec: nowSec,
  claimDueAtSec: dueAtSec,
});

/**
 * After an edit of the schedule: the new first due time starts a new grid,
 * the count stays, and an in-flight claim no longer applies.
 */
export const editPatch = (
  order: RecurringPaymentOrder,
  firstDueAtSec: number,
): RecurringPaymentPatch => ({
  ...movedDuePatch(order, firstDueAtSec),
  claimAtSec: null,
  claimDeviceId: null,
  claimDueAtSec: null,
});

/** Missed periods are not paid retroactively, and a pending one paid early is consumed. */
const nextDueAfterRun = (
  run: Pick<RecurringRun, "order" | "dueAtSec">,
  nowSec: number,
): number => nextDueAfter(run.order.schedule, Math.max(nowSec, run.dueAtSec));

/**
 * Written once the run's money went out. Setting rather than incrementing the
 * count makes a repeat from another device or tab write the same row.
 */
export const runPaidPatch = (
  run: RecurringRun,
  nowSec: number,
): RecurringPaymentPatch => ({
  lastRunAtSec: nowSec,
  lastRunStatus: "paid",
  progress: recurringProgressColumn({
    runCount: run.runIndex + 1,
    nextDueAtSec: nextDueAfterRun(run, nowSec),
  }),
});

/** The run stays due; the planner skips it once its period ends. */
export const runFailedPatch = (nowSec: number): RecurringPaymentPatch => ({
  lastRunAtSec: nowSec,
  lastRunStatus: "failed",
});

/** The period is given up: the schedule moves on and the next run keeps its number. */
export const runSkippedPatch = (
  run: Pick<RecurringRun, "order" | "dueAtSec">,
  nowSec: number,
): RecurringPaymentPatch => ({
  ...movedDuePatch(run.order, nextDueAfterRun(run, nowSec)),
  lastRunAtSec: nowSec,
  lastRunStatus: "skipped",
});

export const pausePatch = (nowSec: number): RecurringPaymentPatch => ({
  pausedAtSec: nowSec,
});

/** Periods that passed while paused are not paid retroactively. */
export const resumePatch = (
  order: RecurringPaymentOrder,
  nowSec: number,
): RecurringPaymentPatch => ({
  ...movedDuePatch(
    order,
    order.schedule.nextDueAtSec > nowSec
      ? order.schedule.nextDueAtSec
      : nextDueAfter(order.schedule, nowSec),
  ),
  pausedAtSec: null,
});
