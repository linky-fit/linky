import type { RecurringPaymentOrder } from "../order";

export const HOUR = 3600;
export const DUE = 1_800_000_000;

/** A 6-hourly sat payment due at `DUE`, unclaimed, never run. */
export const recurringOrderFixture = (
  overrides: Partial<RecurringPaymentOrder> = {},
): RecurringPaymentOrder => ({
  id: "rp-1",
  createdAtSec: DUE - 10 * HOUR,
  contactId: "contact-1",
  amount: { amount: 100, unit: "sat" },
  schedule: {
    anchorAtSec: DUE,
    interval: { unit: "hour", count: 6 },
    timeZone: "UTC",
    nextDueAtSec: DUE,
    runCount: 0,
    pausedAtSec: null,
  },
  lastRunAtSec: null,
  lastRunStatus: null,
  claim: null,
  ...overrides,
});
