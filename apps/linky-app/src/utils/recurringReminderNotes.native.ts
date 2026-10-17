// The notes only name reminders in the service worker's push notifications,
// which the native app has none of.

/** Per reminder time, the note of each recurring payment due then; null for one without a note. */
export type RecurringReminderNotes = ReadonlyMap<
  number,
  ReadonlyArray<string | null>
>;

export const storeRecurringReminderNotes: (
  notes: RecurringReminderNotes,
) => Promise<void> = async () => {};

export const readRecurringReminderNotes: (
  notifyAtSec: number,
) => Promise<ReadonlyArray<string | null> | null> = async () => null;
