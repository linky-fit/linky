import {
  createIdFromString,
  type ContactId,
  type RecurringPaymentId,
} from "@linky-fit/domain";
import {
  recurringProgressColumn,
  type RecurringPaymentColumns,
  type RecurringPaymentOrder,
} from "../order";

export const recurringPaymentIdFor = (key: string): RecurringPaymentId =>
  createIdFromString<"RecurringPayment">(`test/recurring/${key}`);

export const contactIdFor = (key: string): ContactId =>
  createIdFromString<"Contact">(`test/contact/${key}`);

export const HOUR = 3600;
export const DUE = 1_800_000_000;
export const MINT = "https://mint.example";

/** A 6-hourly sat payment over Cashu from `MINT` due at `DUE`, never run. */
export const recurringOrderFixture = (
  overrides: Partial<RecurringPaymentOrder> = {},
): RecurringPaymentOrder => ({
  id: recurringPaymentIdFor("rp-1"),
  createdAtSec: DUE - 10 * HOUR,
  contactId: contactIdFor("contact-1"),
  mintUrl: MINT,
  rail: "cashu",
  amount: { amount: 100, unit: "sat" },
  note: null,
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
  ...overrides,
});

/** The stored columns `recurringOrderFixture()` is read from. */
export const recurringColumnsFixture = (
  overrides: Partial<RecurringPaymentColumns> = {},
): RecurringPaymentColumns => ({
  id: recurringPaymentIdFor("rp-1"),
  createdAtSec: DUE - 10 * HOUR,
  contactId: contactIdFor("contact-1"),
  mintUrl: MINT,
  rail: "cashu",
  amount: 100,
  unit: "sat",
  note: null,
  intervalUnit: "hour",
  intervalCount: 6,
  anchorAtSec: DUE,
  timeZone: "UTC",
  progress: recurringProgressColumn({ runCount: 0, nextDueAtSec: DUE }),
  lastRunAtSec: null,
  lastRunStatus: null,
  pausedAtSec: null,
  ...overrides,
});
