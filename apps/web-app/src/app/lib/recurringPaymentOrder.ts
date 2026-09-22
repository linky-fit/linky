import type {
  ContactId,
  RecurringPaymentId,
  RecurringPaymentRecord,
  TransactionRecord,
} from "@linky-fit/linksync";
import type { JsonValue } from "../../types/json";
import { parseJsonValue, readJsonRecord } from "./transactionHistory";
import { isRecurringAmountUnit, type RecurringAmount } from "./recurringAmount";
import {
  isRecurringIntervalUnit,
  type RecurringScheduleState,
} from "./recurringSchedule";

export type RecurringPaymentRunStatus =
  | "running"
  | "paid"
  | "failed"
  | "skipped"
  | "interrupted";

/** Which device pays the upcoming due time, as last written to the row. */
export interface RecurringPaymentClaim {
  deviceId: string;
  atSec: number;
  dueAtSec: number;
}

/** A `recurringPayment` record validated into what the engine and UI work with. */
export interface RecurringPaymentOrder {
  id: RecurringPaymentId;
  createdAtSec: number;
  contactId: ContactId;
  amount: RecurringAmount;
  schedule: RecurringScheduleState;
  lastRunAtSec: number | null;
  lastRunStatus: RecurringPaymentRunStatus | null;
  claim: RecurringPaymentClaim | null;
}

/** Ties a `transaction` row to the payment and the due time it settled. */
export interface RecurringRunRef {
  recurringPaymentId: string;
  dueAtSec: number;
}

/** Transaction `details` fields that mark a run of a recurring payment. */
export const recurringRunDetails = (
  run: RecurringRunRef | null | undefined,
): Record<string, JsonValue> =>
  run
    ? {
        recurringPaymentId: run.recurringPaymentId,
        recurringDueAtSec: run.dueAtSec,
      }
    : {};

/**
 * Whether the history says a run for this due time moved money: any
 * transaction that names it and did not end in error. A pending Lightning
 * payment counts, since its melt may still settle.
 */
export const recurringRunRecorded = (
  transactions: ReadonlyArray<TransactionRecord>,
  run: RecurringRunRef,
): boolean =>
  transactions.some((transaction) => {
    if (transaction.status === "error" || transaction.status === "declined")
      return false;
    const details = readJsonRecord(parseJsonValue(transaction.detailsJson));
    return (
      details?.recurringPaymentId === run.recurringPaymentId &&
      details.recurringDueAtSec === run.dueAtSec
    );
  });

const RUN_STATUSES: ReadonlyArray<RecurringPaymentRunStatus> = [
  "running",
  "paid",
  "failed",
  "skipped",
  "interrupted",
];

const readRunStatus = (
  value: string | null,
): RecurringPaymentRunStatus | null =>
  RUN_STATUSES.find((status) => status === value) ?? null;

const readClaim = (
  record: RecurringPaymentRecord,
): RecurringPaymentClaim | null => {
  const deviceId = record.claimDeviceId?.trim() ?? "";
  if (!deviceId || record.claimAtSec === null || record.claimDueAtSec === null)
    return null;
  return {
    deviceId,
    atSec: record.claimAtSec,
    dueAtSec: record.claimDueAtSec,
  };
};

/** Null for records this build cannot act on (unknown interval or amount unit). */
export const readRecurringPaymentOrder = (
  record: RecurringPaymentRecord,
): RecurringPaymentOrder | null => {
  if (!isRecurringIntervalUnit(record.intervalUnit)) return null;
  if (!isRecurringAmountUnit(record.unit)) return null;
  return {
    id: record.id,
    createdAtSec: record.createdAtSec,
    contactId: record.contactId,
    amount: { amount: record.amount, unit: record.unit },
    schedule: {
      anchorAtSec: record.anchorAtSec,
      interval: { unit: record.intervalUnit, count: record.intervalCount },
      timeZone: record.timeZone?.trim() || null,
      nextDueAtSec: record.nextDueAtSec,
      runCount: record.runCount ?? 0,
      pausedAtSec: record.pausedAtSec,
    },
    lastRunAtSec: record.lastRunAtSec,
    lastRunStatus: readRunStatus(record.lastRunStatus),
    claim: readClaim(record),
  };
};
