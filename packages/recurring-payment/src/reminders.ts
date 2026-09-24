import type { RecurringPaymentOrder } from "./order";
import { RECURRING_NOTICE_SEC } from "./tick";

/** A reminder server keeps at most this many times per user; the soonest ones matter. */
export const MAX_SYNCED_REMINDERS = 32;

/** When a closed app should be nudged: the notice window before each unpaused next due time. */
export const reminderTimesFor = (
  orders: ReadonlyArray<RecurringPaymentOrder>,
  nowSec: number,
): number[] =>
  orders
    .filter((order) => order.schedule.pausedAtSec === null)
    .map((order) => order.schedule.nextDueAtSec - RECURRING_NOTICE_SEC)
    .filter((notifyAtSec) => notifyAtSec >= nowSec)
    .sort((a, b) => a - b)
    .slice(0, MAX_SYNCED_REMINDERS);
