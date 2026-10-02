import { RecurringPaymentId, type ContactId } from "@linky-fit/domain";
import { Option, Schema } from "effect";
import { isRecurringAmountUnit, type RecurringAmount } from "./amount";
import {
  decideRecurringRun,
  isRecurringIntervalUnit,
  type RecurringScheduleState,
} from "./schedule";

export const RECURRING_RUN_STATUSES = ["paid", "failed", "skipped"] as const;
export type RecurringPaymentRunStatus = (typeof RECURRING_RUN_STATUSES)[number];

export const isRecurringPaymentRunStatus = (
  value: unknown,
): value is RecurringPaymentRunStatus =>
  RECURRING_RUN_STATUSES.some((status) => status === value);

/** How every run reaches the contact: a token over Nostr, or a melt paying their Lightning address. */
export const RECURRING_RAILS = ["cashu", "lightning"] as const;
export type RecurringRail = (typeof RECURRING_RAILS)[number];

export const isRecurringRail = (value: unknown): value is RecurringRail =>
  RECURRING_RAILS.some((rail) => rail === value);

/**
 * Paid runs so far and the pending due time, stored as one column so sync
 * never pairs a count with a due time from another write.
 */
export interface RecurringProgress {
  runCount: number;
  nextDueAtSec: number;
}

const ProgressJson = Schema.parseJson(
  Schema.Struct({
    runCount: Schema.NonNegativeInt,
    nextDueAtSec: Schema.Int.pipe(Schema.positive()),
  }),
);

/** The stored `progress` column for a progress value. */
export const recurringProgressColumn = (progress: RecurringProgress): string =>
  Schema.encodeSync(ProgressJson)(progress);

const readProgress = (column: string): RecurringProgress | null =>
  Option.getOrNull(Schema.decodeUnknownOption(ProgressJson)(column));

/**
 * Which device shows the countdown and notifies for the upcoming due time, as
 * last written to the row. It never decides whether money moves.
 */
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
  /** Every run is paid from this mint. */
  mintUrl: string;
  /** Every run is delivered this way, whatever the contact looks like today. */
  rail: RecurringRail;
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
  mintUrl: string;
  rail: string;
  amount: number;
  unit: string;
  intervalUnit: string;
  intervalCount: number;
  anchorAtSec: number;
  timeZone: string | null;
  /** `recurringProgressColumn` text. */
  progress: string;
  lastRunAtSec: number | null;
  lastRunStatus: string | null;
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

/** Null for rows this build cannot act on (unknown rail, interval or amount unit, unreadable progress). */
export const readRecurringPaymentOrder = (
  columns: RecurringPaymentColumns,
): RecurringPaymentOrder | null => {
  const progress = readProgress(columns.progress);
  if (progress === null) return null;
  if (!isRecurringRail(columns.rail)) return null;
  if (!isRecurringIntervalUnit(columns.intervalUnit)) return null;
  if (!isRecurringAmountUnit(columns.unit)) return null;
  return {
    id: columns.id,
    createdAtSec: columns.createdAtSec,
    contactId: columns.contactId,
    mintUrl: columns.mintUrl,
    rail: columns.rail,
    amount: { amount: columns.amount, unit: columns.unit },
    schedule: {
      anchorAtSec: columns.anchorAtSec,
      interval: { unit: columns.intervalUnit, count: columns.intervalCount },
      timeZone: columns.timeZone?.trim() || null,
      ...progress,
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

/**
 * The key linkshu derives a run's envelope from. It names the payment number,
 * not the due time, so a schedule edit cannot give one payment a second key.
 */
export const recurringEnvelopeKey = (
  orderId: RecurringPaymentId,
  runIndex: number,
): string => `recurring:${orderId}:${runIndex}`;

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

/** The run a transaction's parsed details name, if any. */
export const readRecurringRunRef = (
  details: unknown,
): RecurringRunRef | null => {
  const decoded = Option.getOrNull(
    Schema.decodeUnknownOption(RunDetails)(details),
  );
  if (decoded === null) return null;
  const id = RecurringPaymentId.fromUnknown(decoded.recurringPaymentId);
  return id.ok
    ? { recurringPaymentId: id.value, dueAtSec: decoded.recurringDueAtSec }
    : null;
};
