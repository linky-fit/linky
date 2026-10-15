import {
  ContactId,
  NonEmptyString100,
  NonEmptyString1000,
  PositiveInt,
  type RecurringPaymentsRepository,
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

type RepositoryPatch = Parameters<RecurringPaymentsRepository["update"]>[1];

/**
 * The schedule, amount and note columns a form writes, without an empty
 * note; the due time goes into `progress` through a patch.
 */
export const recurringPaymentColumns = (
  input: RecurringPaymentInput,
  contactId: ContactId,
) => ({
  ...(input.note === null
    ? {}
    : { note: NonEmptyString1000.orThrow(input.note) }),
  contactId,
  amount: PositiveInt.orThrow(input.amount.amount),
  unit: NonEmptyString100.orThrow(input.amount.unit),
  intervalUnit: NonEmptyString100.orThrow(input.interval.unit),
  intervalCount: PositiveInt.orThrow(input.interval.count),
  anchorAtSec: PositiveInt.orThrow(input.firstDueAtSec),
  timeZone: NonEmptyString100.orThrow(currentTimeZone()),
});

export const readContactId = (contactId: string): ContactId | null => {
  const decoded = ContactId.fromUnknown(contactId);
  return decoded.ok ? decoded.value : null;
};

const positiveOrNull = (value: number | null): PositiveInt | null =>
  value === null ? null : PositiveInt.orThrow(value);

/** Brands a package patch for the repository; its values are ours, so a bad one is a bug. */
export const recurringPaymentUpdate = (
  patch: RecurringPaymentPatch,
): RepositoryPatch => ({
  ...(patch.lastRunAtSec !== undefined
    ? { lastRunAtSec: positiveOrNull(patch.lastRunAtSec) }
    : {}),
  ...(patch.lastRunStatus !== undefined
    ? { lastRunStatus: NonEmptyString100.orThrow(patch.lastRunStatus) }
    : {}),
  ...(patch.pausedAtSec !== undefined
    ? { pausedAtSec: positiveOrNull(patch.pausedAtSec) }
    : {}),
  ...(patch.progress !== undefined
    ? { progress: NonEmptyString1000.orThrow(patch.progress) }
    : {}),
});
