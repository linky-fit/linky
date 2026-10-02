import type { PositiveInt } from "@evolu/common";
import { Effect } from "effect";
import type { ContactId } from "@linky-fit/domain";
import type { LinkyDbSchema, RecurringPaymentRow } from "../model/schema";
import type { LinkyStore } from "../model/store";
import { tableRepository, type TableRepository } from "./tableRepository";

/** A recurring payment row whose schedule, progress, mint, rail and recipient columns have all arrived. */
export interface RecurringPaymentRecord extends Omit<
  RecurringPaymentRow,
  | "amount"
  | "anchorAtSec"
  | "contactId"
  | "createdAtSec"
  | "intervalCount"
  | "intervalUnit"
  | "mintUrl"
  | "progress"
  | "rail"
  | "unit"
> {
  readonly amount: PositiveInt;
  readonly anchorAtSec: PositiveInt;
  readonly contactId: ContactId;
  readonly createdAtSec: PositiveInt;
  readonly intervalCount: PositiveInt;
  readonly intervalUnit: string;
  readonly mintUrl: string;
  readonly progress: string;
  readonly rail: string;
  readonly unit: string;
}

export interface RecurringPaymentsRepository extends Omit<
  TableRepository<LinkyDbSchema["recurringPayment"]>,
  "all"
> {
  /** Rows the scheduler can act on; a row still arriving column by column is skipped. */
  readonly all: Effect.Effect<ReadonlyArray<RecurringPaymentRecord>>;
  /** Removed payments; their scope is never forgotten, so every tombstone stays readable. */
  readonly deleted: Effect.Effect<ReadonlyArray<RecurringPaymentRecord>>;
}

export const normalizeRecurringPayment = (
  row: RecurringPaymentRow,
): RecurringPaymentRecord | null => {
  if (
    row.amount === null ||
    row.anchorAtSec === null ||
    row.contactId === null ||
    row.createdAtSec === null ||
    row.intervalCount === null ||
    row.intervalUnit === null ||
    row.mintUrl === null ||
    row.progress === null ||
    row.rail === null ||
    row.unit === null
  ) {
    return null;
  }
  return {
    ...row,
    amount: row.amount,
    anchorAtSec: row.anchorAtSec,
    contactId: row.contactId,
    createdAtSec: row.createdAtSec,
    intervalCount: row.intervalCount,
    intervalUnit: row.intervalUnit,
    mintUrl: row.mintUrl,
    progress: row.progress,
    rail: row.rail,
    unit: row.unit,
  };
};

const toRecords = (
  rows: ReadonlyArray<RecurringPaymentRow>,
): RecurringPaymentRecord[] =>
  rows.flatMap((row) => {
    const record = normalizeRecurringPayment(row);
    return record === null ? [] : [record];
  });

/** The highest shard's copy of each id; `copies` come highest shard first. */
const newestCopies = (
  copies: ReadonlyArray<RecurringPaymentRow>,
): RecurringPaymentRow[] => {
  const newest = new Map<string, RecurringPaymentRow>();
  for (const copy of copies) {
    if (!newest.has(copy.id)) newest.set(copy.id, copy);
  }
  return [...newest.values()];
};

/** Recurring payments live with the contacts they pay, in a scope that is never forgotten. */
export const makeRecurringPaymentsRepository = (
  store: LinkyStore,
): RecurringPaymentsRepository => {
  const table = tableRepository(store, "contacts", "recurringPayment");
  return {
    ...table,
    all: Effect.map(table.all, toRecords),
    deleted: Effect.map(
      store.copies("contacts", "recurringPayment"),
      (copies) =>
        toRecords(newestCopies(copies).filter((row) => row.isDeleted === 1)),
    ),
  };
};
