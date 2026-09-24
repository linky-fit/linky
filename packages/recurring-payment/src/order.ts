import { RecurringPaymentId, type ContactId } from "@linky/domain";
import { Option, Schema } from "effect";
import { isRecurringAmountUnit, type RecurringAmount } from "./amount";
import {
  decideRecurringRun,
  isRecurringIntervalUnit,
  type RecurringScheduleState,
} from "./schedule";

export const RECURRING_RUN_STATUSES = [
  "running",
  "paid",
  "failed",
  "skipped",
  "interrupted",
] as const;
export type RecurringPaymentRunStatus = (typeof RECURRING_RUN_STATUSES)[number];

export const isRecurringPaymentRunStatus = (
  value: unknown,
): value is RecurringPaymentRunStatus =>
  RECURRING_RUN_STATUSES.some((status) => status === value);

/** Which device pays the upcoming due time, as last written to the row. */
export interface RecurringPaymentClaim {
  deviceId: string;
  atSec: number;
  dueAtSec: number;
}

/** A recurring payment as the planner and the UI see it. */
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

/** The stored columns an order is read from, before any validation. */
export interface RecurringPaymentColumns {
  id: RecurringPaymentId;
  createdAtSec: number;
  contactId: ContactId;
  amount: number;
  unit: string;
  intervalUnit: string;
  intervalCount: number;
  anchorAtSec: number;
  timeZone: string | null;
  nextDueAtSec: number;
  lastRunAtSec: number | null;
  lastRunStatus: string | null;
  runCount: number | null;
  pausedAtSec: number | null;
  claimDeviceId: string | null;
  claimAtSec: number | null;
  claimDueAtSec: number | null;
}

const readClaim = (
  columns: RecurringPaymentColumns,
): RecurringPaymentClaim | null => {
  const deviceId = columns.claimDeviceId?.trim() ?? "";
  if (
    !deviceId ||
    columns.claimAtSec === null ||
    columns.claimDueAtSec === null
  ) {
    return null;
  }
  return {
    deviceId,
    atSec: columns.claimAtSec,
    dueAtSec: columns.claimDueAtSec,
  };
};

/** Null for rows this build cannot act on (unknown interval or amount unit). */
export const readRecurringPaymentOrder = (
  columns: RecurringPaymentColumns,
): RecurringPaymentOrder | null => {
  if (!isRecurringIntervalUnit(columns.intervalUnit)) return null;
  if (!isRecurringAmountUnit(columns.unit)) return null;
  return {
    id: columns.id,
    createdAtSec: columns.createdAtSec,
    contactId: columns.contactId,
    amount: { amount: columns.amount, unit: columns.unit },
    schedule: {
      anchorAtSec: columns.anchorAtSec,
      interval: { unit: columns.intervalUnit, count: columns.intervalCount },
      timeZone: columns.timeZone?.trim() || null,
      nextDueAtSec: columns.nextDueAtSec,
      runCount: columns.runCount ?? 0,
      pausedAtSec: columns.pausedAtSec,
    },
    lastRunAtSec: columns.lastRunAtSec,
    lastRunStatus: isRecurringPaymentRunStatus(columns.lastRunStatus)
      ? columns.lastRunStatus
      : null,
    claim: readClaim(columns),
  };
};

export type RecurringOrderState = "active" | "paused";

export const recurringOrderState = (
  order: RecurringPaymentOrder,
  nowSec: number,
): RecurringOrderState =>
  decideRecurringRun(order.schedule, nowSec).kind === "paused"
    ? "paused"
    : "active";

/** Ties a transaction to the payment and the due time it settled. */
export interface RecurringRunRef {
  recurringPaymentId: RecurringPaymentId;
  dueAtSec: number;
}

const RunDetails = Schema.Struct({
  recurringPaymentId: Schema.String,
  recurringDueAtSec: Schema.Number,
});

/** Transaction details fields that mark a run of a recurring payment. */
export const recurringRunDetails = (
  run: RecurringRunRef | null | undefined,
): Record<string, string | number> =>
  run
    ? {
        recurringPaymentId: run.recurringPaymentId,
        recurringDueAtSec: run.dueAtSec,
      }
    : {};

const runRefFrom = (
  details: typeof RunDetails.Type | null,
): RecurringRunRef | null => {
  if (details === null) return null;
  const id = RecurringPaymentId.fromUnknown(details.recurringPaymentId);
  return id.ok
    ? { recurringPaymentId: id.value, dueAtSec: details.recurringDueAtSec }
    : null;
};

/** The run a transaction's parsed details name, if any. */
export const readRecurringRunRef = (details: unknown): RecurringRunRef | null =>
  runRefFrom(Option.getOrNull(Schema.decodeUnknownOption(RunDetails)(details)));

export interface RecordedTransaction {
  status: string | null;
  detailsJson: string | null;
}

const readRunRefFromJson = Schema.decodeUnknownOption(
  Schema.parseJson(RunDetails),
);

/**
 * Whether the history says a run for this due time moved money: any
 * transaction that names it and did not end in error. A pending Lightning
 * payment counts, since its melt may still settle.
 */
export const recurringRunRecorded = (
  transactions: ReadonlyArray<RecordedTransaction>,
  run: RecurringRunRef,
): boolean =>
  transactions.some((transaction) => {
    if (transaction.status === "error" || transaction.status === "declined")
      return false;
    const recorded = runRefFrom(
      Option.getOrNull(readRunRefFromJson(transaction.detailsJson)),
    );
    return (
      recorded?.recurringPaymentId === run.recurringPaymentId &&
      recorded.dueAtSec === run.dueAtSec
    );
  });
