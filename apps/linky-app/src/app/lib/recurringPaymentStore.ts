import {
  ContactId,
  type RecurringPaymentPatch as RepositoryPatch,
} from "@linky-fit/linksync";
import {
  currentTimeZone,
  type RecurringAmount,
  type RecurringInterval,
  type RecurringPaymentPatch,
} from "@linky-fit/recurring-payment";

export interface RecurringPaymentInput {
  amount: RecurringAmount;
  contactId: string;
  /** The next due time; also the anchor every later due time is counted from. */
  firstDueAtSec: number;
  interval: RecurringInterval;
  /** Trimmed; null without one. */
  note: string | null;
}

/**
 * The schedule, amount and note columns a form writes, without an empty
 * note; the due time goes into `progress` through a patch.
 */
export const recurringPaymentColumns = (
  input: RecurringPaymentInput,
  contactId: ContactId,
) => ({
  ...(input.note === null ? {} : { note: input.note }),
  contactId,
  amount: input.amount.amount,
  unit: input.amount.unit,
  intervalUnit: input.interval.unit,
  intervalCount: input.interval.count,
  anchorAtSec: input.firstDueAtSec,
  timeZone: currentTimeZone(),
});

export const readContactId = (contactId: string): ContactId | null => {
  const decoded = ContactId.fromUnknown(contactId);
  return decoded.ok ? decoded.value : null;
};

/** Maps a package patch for the repository. */
export const recurringPaymentUpdate = (
  patch: RecurringPaymentPatch,
): RepositoryPatch => ({
  ...(patch.lastRunAtSec !== undefined
    ? { lastRunAtSec: patch.lastRunAtSec }
    : {}),
  ...(patch.lastRunStatus !== undefined
    ? { lastRunStatus: patch.lastRunStatus }
    : {}),
  ...(patch.pausedAtSec !== undefined
    ? { pausedAtSec: patch.pausedAtSec }
    : {}),
  ...(patch.progress !== undefined ? { progress: patch.progress } : {}),
});
