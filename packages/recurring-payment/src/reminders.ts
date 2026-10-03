import type { RecurringPaymentOrder } from "./order";

/** A reminder server keeps at most this many times per user; the soonest ones matter. */
export const MAX_SYNCED_REMINDERS = 32;

const unpaused = (orders: ReadonlyArray<RecurringPaymentOrder>) =>
  orders.filter((order) => order.schedule.pausedAtSec === null);

/** When a closed app should be nudged: each distinct unpaused next due time. */
export const reminderTimesFor = (
  orders: ReadonlyArray<RecurringPaymentOrder>,
  nowSec: number,
): number[] =>
  [...new Set(unpaused(orders).map((order) => order.schedule.nextDueAtSec))]
    .filter((notifyAtSec) => notifyAtSec >= nowSec)
    .sort((a, b) => a - b)
    .slice(0, MAX_SYNCED_REMINDERS);

/** Per reminder time, the note of each order due then (null without one), so a nudge can name them. */
export const reminderNotesFor = (
  orders: ReadonlyArray<RecurringPaymentOrder>,
  nowSec: number,
): Map<number, Array<string | null>> => {
  const notes = new Map(
    reminderTimesFor(orders, nowSec).map((notifyAtSec) => [
      notifyAtSec,
      new Array<string | null>(),
    ]),
  );
  for (const order of unpaused(orders)) {
    notes.get(order.schedule.nextDueAtSec)?.push(order.note);
  }
  return notes;
};
