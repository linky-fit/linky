import {
  ContactId,
  NonEmptyString100,
  NonNegativeInt,
  PositiveInt,
  type RecurringPaymentsRepository,
} from "@linky/linksync";
import {
  currentTimeZone,
  type RecurringAmount,
  type RecurringInterval,
  type RecurringPaymentPatch,
} from "@linky/recurring-payment";

export interface RecurringPaymentInput {
  amount: RecurringAmount;
  contactId: string;
  /** The next due time; also the anchor every later due time is counted from. */
  firstDueAtSec: number;
  interval: RecurringInterval;
}

type RepositoryPatch = Parameters<RecurringPaymentsRepository["update"]>[1];

/** The schedule and amount columns a form writes, for both insert and edit. */
export const recurringPaymentColumns = (
  input: RecurringPaymentInput,
  contactId: ContactId,
) => ({
  contactId,
  amount: PositiveInt.orThrow(input.amount.amount),
  unit: NonEmptyString100.orThrow(input.amount.unit),
  intervalUnit: NonEmptyString100.orThrow(input.interval.unit),
  intervalCount: PositiveInt.orThrow(input.interval.count),
  anchorAtSec: PositiveInt.orThrow(input.firstDueAtSec),
  timeZone: NonEmptyString100.orThrow(currentTimeZone()),
  nextDueAtSec: PositiveInt.orThrow(input.firstDueAtSec),
});

export const readContactId = (contactId: string): ContactId | null => {
  const decoded = ContactId.fromUnknown(contactId);
  return decoded.ok ? decoded.value : null;
};

const positive = (value: number): PositiveInt => PositiveInt.orThrow(value);
const positiveOrNull = (value: number | null): PositiveInt | null =>
  value === null ? null : positive(value);

/** Brands a package patch for the repository; its values are ours, so a bad one is a bug. */
export const recurringPaymentUpdate = (
  patch: RecurringPaymentPatch,
): RepositoryPatch => ({
  ...(patch.claimAtSec !== undefined
    ? { claimAtSec: positiveOrNull(patch.claimAtSec) }
    : {}),
  ...(patch.claimDeviceId !== undefined
    ? {
        claimDeviceId:
          patch.claimDeviceId === null
            ? null
            : NonEmptyString100.orThrow(patch.claimDeviceId),
      }
    : {}),
  ...(patch.claimDueAtSec !== undefined
    ? { claimDueAtSec: positiveOrNull(patch.claimDueAtSec) }
    : {}),
  ...(patch.lastRunAtSec !== undefined
    ? { lastRunAtSec: positiveOrNull(patch.lastRunAtSec) }
    : {}),
  ...(patch.lastRunStatus !== undefined
    ? { lastRunStatus: NonEmptyString100.orThrow(patch.lastRunStatus) }
    : {}),
  ...(patch.nextDueAtSec !== undefined
    ? { nextDueAtSec: positive(patch.nextDueAtSec) }
    : {}),
  ...(patch.pausedAtSec !== undefined
    ? { pausedAtSec: positiveOrNull(patch.pausedAtSec) }
    : {}),
  ...(patch.runCount !== undefined
    ? { runCount: NonNegativeInt.orThrow(patch.runCount) }
    : {}),
});
