import { Schema } from "effect";
import type { JsonValue } from "../../types/json";
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

/** A `recurringPayment` row validated into what the engine and UI work with. */
export interface RecurringPaymentOrder {
  id: string;
  ownerId: string | null;
  createdAtSec: number;
  contactId: string;
  amountSat: number;
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

const PositiveIntFromRow = Schema.Number.pipe(Schema.int(), Schema.positive());
const NullableText = Schema.NullishOr(Schema.String);
const NullablePositiveInt = Schema.NullishOr(PositiveIntFromRow);

const RecurringPaymentRowSchema = Schema.Struct({
  id: Schema.String,
  ownerId: NullableText,
  createdAtSec: PositiveIntFromRow,
  contactId: NullableText,
  amountSat: PositiveIntFromRow,
  intervalUnit: Schema.String,
  intervalCount: PositiveIntFromRow,
  anchorAtSec: PositiveIntFromRow,
  timeZone: NullableText,
  nextDueAtSec: PositiveIntFromRow,
  lastRunAtSec: NullablePositiveInt,
  lastRunStatus: NullableText,
  runCount: Schema.NullishOr(
    Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  ),
  maxRuns: NullablePositiveInt,
  endAtSec: NullablePositiveInt,
  pausedAtSec: NullablePositiveInt,
  claimDeviceId: NullableText,
  claimAtSec: NullablePositiveInt,
  claimDueAtSec: NullablePositiveInt,
});

const decodeRow = Schema.decodeUnknownOption(RecurringPaymentRowSchema);

const RUN_STATUSES: ReadonlyArray<RecurringPaymentRunStatus> = [
  "running",
  "paid",
  "failed",
  "skipped",
  "interrupted",
];

const readRunStatus = (
  value: string | null | undefined,
): RecurringPaymentRunStatus | null =>
  RUN_STATUSES.find((status) => status === value) ?? null;

const blankToNull = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
};

const readClaim = (row: {
  claimDeviceId: string | null | undefined;
  claimAtSec: number | null | undefined;
  claimDueAtSec: number | null | undefined;
}): RecurringPaymentClaim | null => {
  const deviceId = blankToNull(row.claimDeviceId);
  if (deviceId === null || !row.claimAtSec || !row.claimDueAtSec) return null;
  return { deviceId, atSec: row.claimAtSec, dueAtSec: row.claimDueAtSec };
};

/** Null for rows this build cannot act on (unknown unit, missing contact). */
export const readRecurringPaymentOrder = (
  row: unknown,
): RecurringPaymentOrder | null => {
  const decoded = decodeRow(row);
  if (decoded._tag === "None") return null;
  const value = decoded.value;
  if (!isRecurringIntervalUnit(value.intervalUnit)) return null;
  const contactId = blankToNull(value.contactId);
  if (contactId === null) return null;
  return {
    id: value.id,
    ownerId: blankToNull(value.ownerId),
    createdAtSec: value.createdAtSec,
    contactId,
    amountSat: value.amountSat,
    schedule: {
      anchorAtSec: value.anchorAtSec,
      interval: { unit: value.intervalUnit, count: value.intervalCount },
      timeZone: blankToNull(value.timeZone),
      nextDueAtSec: value.nextDueAtSec,
      runCount: value.runCount ?? 0,
      maxRuns: value.maxRuns ?? null,
      endAtSec: value.endAtSec ?? null,
      pausedAtSec: value.pausedAtSec ?? null,
    },
    lastRunAtSec: value.lastRunAtSec ?? null,
    lastRunStatus: readRunStatus(value.lastRunStatus),
    claim: readClaim(value),
  };
};
