import type { RecurringPaymentOrder, RecurringPaymentRunStatus } from "./order";
import { nextDueAfter, type RecurringScheduleAdvance } from "./schedule";

/** The columns one state change writes; the app brands them for its store. */
export interface RecurringPaymentPatch {
  claimAtSec?: number | null;
  claimDeviceId?: string | null;
  claimDueAtSec?: number | null;
  lastRunAtSec?: number | null;
  lastRunStatus?: RecurringPaymentRunStatus;
  nextDueAtSec?: number;
  pausedAtSec?: number | null;
  runCount?: number;
}

/** This device takes the due time; the last writer to sync is the one that pays. */
export const claimPatch = (
  deviceId: string,
  nowSec: number,
  dueAtSec: number,
): RecurringPaymentPatch => ({
  claimDeviceId: deviceId,
  claimAtSec: nowSec,
  claimDueAtSec: dueAtSec,
});

/** After an edit: a new grid starts and an in-flight claim no longer applies. */
export const CLEAR_CLAIM_PATCH: RecurringPaymentPatch = {
  claimAtSec: null,
  claimDeviceId: null,
  claimDueAtSec: null,
};

/**
 * Written before money moves, with the schedule already advanced, so no other
 * pass or device pays the same period.
 */
export const runStartedPatch = (
  advance: RecurringScheduleAdvance,
  startedAtSec: number,
): RecurringPaymentPatch => ({
  lastRunAtSec: startedAtSec,
  lastRunStatus: "running",
  nextDueAtSec: advance.nextDueAtSec,
  runCount: advance.runCount,
});

export const RUN_PAID_PATCH: RecurringPaymentPatch = { lastRunStatus: "paid" };

/**
 * Rolls the schedule back to the due time so the next pass retries; the
 * planner skips the run for good once its period ends.
 */
export const runFailedPatch = (
  order: RecurringPaymentOrder,
): RecurringPaymentPatch => ({
  lastRunStatus: "failed",
  nextDueAtSec: order.schedule.nextDueAtSec,
  runCount: order.schedule.runCount,
});

/** The period is given up; the schedule moves on. */
export const runSkippedPatch = (
  advance: RecurringScheduleAdvance,
  nowSec: number,
): RecurringPaymentPatch => ({
  lastRunAtSec: nowSec,
  lastRunStatus: "skipped",
  nextDueAtSec: advance.nextDueAtSec,
  runCount: advance.runCount,
});

/**
 * Settles a run that never finished (the app died mid-payment). Its schedule
 * is already advanced. When the history records the payment the run is paid;
 * when it does not, the money never moved, so the claimed due time is
 * restored and the payment goes out on a later pass instead of vanishing.
 */
export const interruptedRunPatch = (
  order: RecurringPaymentOrder,
  recorded: boolean,
): RecurringPaymentPatch => {
  if (recorded) return RUN_PAID_PATCH;
  const dueAtSec = order.claim?.dueAtSec;
  return dueAtSec === undefined
    ? { lastRunStatus: "interrupted" }
    : {
        lastRunStatus: "interrupted",
        nextDueAtSec: dueAtSec,
        runCount: Math.max(0, order.schedule.runCount - 1),
      };
};

export const pausePatch = (nowSec: number): RecurringPaymentPatch => ({
  pausedAtSec: nowSec,
});

/** Periods that passed while paused are not paid retroactively. */
export const resumePatch = (
  order: RecurringPaymentOrder,
  nowSec: number,
): RecurringPaymentPatch => ({
  pausedAtSec: null,
  nextDueAtSec:
    order.schedule.nextDueAtSec > nowSec
      ? order.schedule.nextDueAtSec
      : nextDueAfter(order.schedule, nowSec),
});
