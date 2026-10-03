import type { RecurringPaymentOrder } from "./order";

/** A reminder server keeps at most this many times per user; the soonest ones matter. */
export const MAX_SYNCED_REMINDERS = 32;

/** How long after a due time a closed app is nudged, so a running app that sends the payment can cancel the nudge first. */
export const RECURRING_REMINDER_GRACE_SEC = 60;

/** The unpaused orders not yet due, grouped by reminder time, soonest first. */
const upcomingByReminderTime = (
  orders: ReadonlyArray<RecurringPaymentOrder>,
  nowSec: number,
): Array<[number, RecurringPaymentOrder[]]> => {
  const byTime = new Map<number, RecurringPaymentOrder[]>();
  for (const order of orders) {
    const { nextDueAtSec, pausedAtSec } = order.schedule;
    if (pausedAtSec !== null || nextDueAtSec <= nowSec) continue;
    const notifyAtSec = nextDueAtSec + RECURRING_REMINDER_GRACE_SEC;
    byTime.set(notifyAtSec, [...(byTime.get(notifyAtSec) ?? []), order]);
  }
  return [...byTime].sort(([a], [b]) => a - b).slice(0, MAX_SYNCED_REMINDERS);
};

/** When a closed app should be nudged: each distinct unpaused due time still ahead, plus the grace. */
export const reminderTimesFor = (
  orders: ReadonlyArray<RecurringPaymentOrder>,
  nowSec: number,
): number[] =>
  upcomingByReminderTime(orders, nowSec).map(([notifyAtSec]) => notifyAtSec);

/** Per reminder time, the note of each order due then (null without one), so a nudge can name them. */
export const reminderNotesFor = (
  orders: ReadonlyArray<RecurringPaymentOrder>,
  nowSec: number,
): Map<number, Array<string | null>> =>
  new Map(
    upcomingByReminderTime(orders, nowSec).map(([notifyAtSec, due]) => [
      notifyAtSec,
      due.map((order) => order.note),
    ]),
  );
