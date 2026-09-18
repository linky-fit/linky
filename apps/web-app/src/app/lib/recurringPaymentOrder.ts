import { Schema } from "effect";
import type { JsonValue } from "../../types/json";
import {
  isRecurringIntervalUnit,
  type RecurringScheduleState,
} from "./recurringSchedule";

export type RecurringPaymentRecipient =
  | { kind: "contact"; contactId: string }
  | { kind: "lnAddress"; lnAddress: string };

export type RecurringPaymentRunStatus =
  | "running"
  | "paid"
  | "failed"
  | "skipped"
  | "interrupted";

/** A `recurringPayment` row validated into what the engine and UI work with. */
export interface RecurringPaymentOrder {
  id: string;
  ownerId: string | null;
  createdAtSec: number;
  title: string;
  recipient: RecurringPaymentRecipient;
  amountSat: number;
  schedule: RecurringScheduleState;
  lastRunAtSec: number | null;
  lastRunStatus: RecurringPaymentRunStatus | null;
  executorDeviceId: string | null;
  note: string | null;
}

/** Ties a `transaction` row to the order and the due time it settled. */
export interface RecurringRunRef {
  recurringPaymentId: string;
  dueAtSec: number;
}

/** Transaction `details` fields that mark a run of a standing order. */
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
  title: Schema.String,
  recipientKind: Schema.String,
  contactId: NullableText,
  lnAddress: NullableText,
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
  executorDeviceId: NullableText,
  note: NullableText,
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

const readRecipient = (row: {
  recipientKind: string;
  contactId: string | null | undefined;
  lnAddress: string | null | undefined;
}): RecurringPaymentRecipient | null => {
  if (row.recipientKind === "contact") {
    const contactId = row.contactId?.trim() ?? "";
    return contactId ? { kind: "contact", contactId } : null;
  }
  if (row.recipientKind === "lnAddress") {
    const lnAddress = row.lnAddress?.trim() ?? "";
    return lnAddress ? { kind: "lnAddress", lnAddress } : null;
  }
  return null;
};

const blankToNull = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
};

/** Null for rows this build cannot act on (unknown unit, missing recipient). */
export const readRecurringPaymentOrder = (
  row: unknown,
): RecurringPaymentOrder | null => {
  const decoded = decodeRow(row);
  if (decoded._tag === "None") return null;
  const value = decoded.value;
  if (!isRecurringIntervalUnit(value.intervalUnit)) return null;
  const recipient = readRecipient(value);
  if (recipient === null) return null;
  const title = value.title.trim();
  if (!title) return null;
  return {
    id: value.id,
    ownerId: blankToNull(value.ownerId),
    createdAtSec: value.createdAtSec,
    title,
    recipient,
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
    executorDeviceId: blankToNull(value.executorDeviceId),
    note: blankToNull(value.note),
  };
};
