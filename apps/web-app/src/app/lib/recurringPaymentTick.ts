import type { RecurringPaymentOrder } from "./recurringPaymentOrder";
import {
  advanceRecurringSchedule,
  decideRecurringRun,
  nextRecurringOccurrenceAfter,
  resolveTimeZone,
  type RecurringScheduleAdvance,
} from "./recurringSchedule";

/** How long a due run waits for funds or retries failures before it is skipped. */
export const RECURRING_RUN_GRACE_SEC = 24 * 60 * 60;
/** Pause between attempts of a run whose last attempt failed. */
export const RECURRING_RUN_RETRY_DELAY_SEC = 10 * 60;
/** A `running` mark older than this belongs to a launch that died mid-run. */
export const RECURRING_RUN_STALE_SEC = 15 * 60;

export type RecurringSkipReason =
  | "insufficientFunds"
  | "failed"
  | "invalidRecipient";

export type RecurringTickAction =
  | {
      kind: "run";
      order: RecurringPaymentOrder;
      dueAtSec: number;
      missedCount: number;
      advance: RecurringScheduleAdvance;
    }
  | {
      kind: "skip";
      order: RecurringPaymentOrder;
      dueAtSec: number;
      reason: RecurringSkipReason;
      advance: RecurringScheduleAdvance;
    }
  | { kind: "waitFunds"; order: RecurringPaymentOrder; dueAtSec: number }
  | { kind: "markInterrupted"; order: RecurringPaymentOrder };

export interface RecurringTickInput {
  orders: ReadonlyArray<RecurringPaymentOrder>;
  nowSec: number;
  deviceId: string;
  cashuBalance: number;
  /** Per order id: no new attempt before this time (set after a failure). */
  retryNotBeforeSec: ReadonlyMap<string, number>;
}

/** End of the window in which a due run may still be attempted. */
export const recurringSkipDeadlineSec = (
  order: RecurringPaymentOrder,
  dueAtSec: number,
): number =>
  Math.min(
    dueAtSec + RECURRING_RUN_GRACE_SEC,
    nextRecurringOccurrenceAfter(
      order.schedule.anchorAtSec,
      order.schedule.interval,
      dueAtSec,
      resolveTimeZone(order.schedule.timeZone),
    ).dueAtSec,
  );

const planOrder = (
  order: RecurringPaymentOrder,
  input: RecurringTickInput,
): RecurringTickAction | null => {
  if (
    order.executorDeviceId !== null &&
    order.executorDeviceId !== input.deviceId
  ) {
    return null;
  }
  if (order.lastRunStatus === "running") {
    const startedAt = order.lastRunAtSec ?? 0;
    return input.nowSec - startedAt > RECURRING_RUN_STALE_SEC
      ? { kind: "markInterrupted", order }
      : null;
  }
  const decision = decideRecurringRun(order.schedule, input.nowSec);
  if (decision.kind !== "due") return null;
  const dueAtSec = decision.dueAtSec;
  const advance = advanceRecurringSchedule(order.schedule, input.nowSec);
  const deadlinePassed =
    input.nowSec >= recurringSkipDeadlineSec(order, dueAtSec);
  const attemptedThisPeriod =
    order.lastRunStatus === "failed" &&
    order.lastRunAtSec !== null &&
    order.lastRunAtSec >= dueAtSec;
  if (attemptedThisPeriod && deadlinePassed) {
    return { kind: "skip", order, dueAtSec, reason: "failed", advance };
  }
  if (input.cashuBalance < order.amountSat) {
    return deadlinePassed
      ? { kind: "skip", order, dueAtSec, reason: "insufficientFunds", advance }
      : { kind: "waitFunds", order, dueAtSec };
  }
  const retryNotBefore = input.retryNotBeforeSec.get(order.id) ?? 0;
  if (input.nowSec < retryNotBefore) return null;
  return {
    kind: "run",
    order,
    dueAtSec,
    missedCount: decision.missedCount,
    advance,
  };
};

/**
 * What one scheduler pass should do. Runs come out ordered by due time so
 * the longest-overdue order goes first when the wallet is free.
 */
export const planRecurringPaymentTick = (
  input: RecurringTickInput,
): RecurringTickAction[] => {
  const actions = input.orders.flatMap((order) => {
    const action = planOrder(order, input);
    return action === null ? [] : [action];
  });
  const dueOf = (action: RecurringTickAction): number =>
    action.kind === "markInterrupted" ? 0 : action.dueAtSec;
  return actions.sort((a, b) => dueOf(a) - dueOf(b));
};
