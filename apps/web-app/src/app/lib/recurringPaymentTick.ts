import type { RecurringPaymentOrder } from "./recurringPaymentOrder";
import {
  advanceRecurringSchedule,
  decideRecurringRun,
  nextRecurringOccurrenceAfter,
  resolveTimeZone,
  type RecurringScheduleAdvance,
} from "./recurringSchedule";

/**
 * Lead time between claiming a due payment and sending it. The user is
 * notified at claim time; the window also lets claims written by devices that
 * raced each other converge through sync, so a single device pays.
 */
export const RECURRING_NOTICE_SEC = 60;
/**
 * Countdown shown in the app before a due payment goes out, with pay-now and
 * cancel. Only when Linky is visible; in the background the payment is sent
 * at its send time without it.
 */
export const RECURRING_CONFIRM_SEC = 10;
/** A claim this far past its send time belongs to a device that went away. */
export const RECURRING_CLAIM_TAKEOVER_SEC = 10 * 60;
/** Pause between attempts of a run whose last attempt failed. */
export const RECURRING_RUN_RETRY_DELAY_SEC = 10 * 60;
/** A `running` mark older than this belongs to a launch that died mid-run. */
export const RECURRING_RUN_STALE_SEC = 15 * 60;

export type RecurringSkipReason =
  | "insufficientFunds"
  | "failed"
  | "cancelled"
  | "invalidRecipient";

export type RecurringTickAction =
  | {
      kind: "claim";
      order: RecurringPaymentOrder;
      dueAtSec: number;
      takeover: boolean;
    }
  | {
      kind: "run";
      order: RecurringPaymentOrder;
      amountSat: number;
      dueAtSec: number;
      missedCount: number;
      advance: RecurringScheduleAdvance;
    }
  | {
      kind: "skip";
      order: RecurringPaymentOrder;
      dueAtSec: number;
      reason: Extract<RecurringSkipReason, "insufficientFunds" | "failed">;
      advance: RecurringScheduleAdvance;
    }
  | { kind: "waitFunds"; order: RecurringPaymentOrder; dueAtSec: number }
  | { kind: "waitRates"; order: RecurringPaymentOrder; dueAtSec: number }
  | { kind: "markInterrupted"; order: RecurringPaymentOrder };

export interface RecurringTickInput {
  orders: ReadonlyArray<RecurringPaymentOrder>;
  nowSec: number;
  deviceId: string;
  cashuBalance: number;
  /** Sats the payment sends now; null while a fiat amount has no exchange rate. */
  amountSatOf: (order: RecurringPaymentOrder) => number | null;
  /** Per order id: no new attempt before this time (set after a failure). */
  retryNotBeforeSec: ReadonlyMap<string, number>;
}

export interface RecurringUpcoming {
  dueAtSec: number;
  /** When the claiming device sends it; null while nobody has claimed it. */
  sendAtSec: number | null;
  claimDeviceId: string | null;
}

/**
 * The due payment inside the notice window (or already overdue), with its
 * claim when one exists for that due time. Null when nothing is due soon.
 */
export const recurringUpcoming = (
  order: RecurringPaymentOrder,
  nowSec: number,
): RecurringUpcoming | null => {
  if (order.lastRunStatus === "running") return null;
  const decision = decideRecurringRun(
    order.schedule,
    nowSec + RECURRING_NOTICE_SEC,
  );
  if (decision.kind !== "due") return null;
  const claim =
    order.claim?.dueAtSec === decision.dueAtSec ? order.claim : null;
  return {
    dueAtSec: decision.dueAtSec,
    sendAtSec:
      claim === null
        ? null
        : Math.max(decision.dueAtSec, claim.atSec + RECURRING_NOTICE_SEC),
    claimDeviceId: claim?.deviceId ?? null,
  };
};

/**
 * End of the window in which a due run may still be attempted: the next due
 * time. A payment waits for funds or retries failures for its whole period,
 * so a late or unfunded one still goes out once the wallet allows; only when
 * the following period is already due does the missed one fold into it.
 */
export const recurringSkipDeadlineSec = (
  order: RecurringPaymentOrder,
  dueAtSec: number,
): number =>
  nextRecurringOccurrenceAfter(
    order.schedule.anchorAtSec,
    order.schedule.interval,
    dueAtSec,
    resolveTimeZone(order.schedule.timeZone),
  ).dueAtSec;

const planOrder = (
  order: RecurringPaymentOrder,
  input: RecurringTickInput,
): RecurringTickAction | null => {
  if (order.lastRunStatus === "running") {
    const startedAt = order.lastRunAtSec ?? 0;
    return input.nowSec - startedAt > RECURRING_RUN_STALE_SEC
      ? { kind: "markInterrupted", order }
      : null;
  }
  const upcoming = recurringUpcoming(order, input.nowSec);
  if (upcoming === null) return null;
  const { dueAtSec, sendAtSec, claimDeviceId } = upcoming;
  if (sendAtSec === null) {
    return { kind: "claim", order, dueAtSec, takeover: false };
  }
  if (input.nowSec < sendAtSec) return null;
  if (claimDeviceId !== input.deviceId) {
    return input.nowSec >= sendAtSec + RECURRING_CLAIM_TAKEOVER_SEC
      ? { kind: "claim", order, dueAtSec, takeover: true }
      : null;
  }

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
  const amountSat = input.amountSatOf(order);
  if (amountSat === null) return { kind: "waitRates", order, dueAtSec };
  if (input.cashuBalance < amountSat) {
    return deadlinePassed
      ? { kind: "skip", order, dueAtSec, reason: "insufficientFunds", advance }
      : { kind: "waitFunds", order, dueAtSec };
  }
  const retryNotBefore = input.retryNotBeforeSec.get(order.id) ?? 0;
  if (input.nowSec < retryNotBefore) return null;
  const decision = decideRecurringRun(order.schedule, input.nowSec);
  return {
    kind: "run",
    order,
    amountSat,
    dueAtSec,
    missedCount: decision.kind === "due" ? decision.missedCount : 0,
    advance,
  };
};

/**
 * What one scheduler pass should do. Actions come out ordered by due time so
 * the longest-overdue payment goes first when the wallet is free.
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
