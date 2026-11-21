import type { ContactId } from "@linky-fit/domain";
import { Effect } from "effect";
import type { LinkyDbSchema } from "../model/schema";
import type { LinkyStore } from "../model/store";
import {
  domainTableRepository,
  toDomainRow,
  type DomainPatch,
  type DomainRow,
  type DomainTableRepository,
  type DomainWriteRow,
} from "./domainRepository";

export type RecurringPaymentStoredRow = DomainRow<
  LinkyDbSchema["recurringPayment"]
>;
export type RecurringPaymentInsert = DomainWriteRow<
  LinkyDbSchema["recurringPayment"]
>;
export type RecurringPaymentPatch = DomainPatch<
  LinkyDbSchema["recurringPayment"]
>;

/** A recurring payment row whose schedule, progress, mint, rail and recipient columns have all arrived. */
export interface RecurringPaymentRecord extends Omit<
  RecurringPaymentStoredRow,
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
  readonly amount: number;
  readonly anchorAtSec: number;
  readonly contactId: ContactId;
  readonly createdAtSec: number;
  readonly intervalCount: number;
  readonly intervalUnit: string;
  readonly mintUrl: string;
  readonly progress: string;
  readonly rail: string;
  readonly unit: string;
}

export interface RecurringPaymentsRepository extends Omit<
  DomainTableRepository<LinkyDbSchema["recurringPayment"]>,
  "all"
> {
  /** Rows the scheduler can act on; a row still arriving column by column is skipped. */
  readonly all: Effect.Effect<ReadonlyArray<RecurringPaymentRecord>>;
  /** Removed payments; their scope is never forgotten, so every tombstone stays readable. */
  readonly deleted: Effect.Effect<ReadonlyArray<RecurringPaymentRecord>>;
}

export const normalizeRecurringPayment = (
  row: RecurringPaymentStoredRow,
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
  rows: ReadonlyArray<RecurringPaymentStoredRow>,
): RecurringPaymentRecord[] =>
  rows.flatMap((row) => {
    const record = normalizeRecurringPayment(row);
    return record === null ? [] : [record];
  });

/** The highest shard's copy of each id; `copies` come highest shard first. */
const newestCopies = <R extends { readonly id: string }>(
  copies: ReadonlyArray<R>,
): R[] => {
  const newest = new Map<string, R>();
  for (const copy of copies) {
    if (!newest.has(copy.id)) newest.set(copy.id, copy);
  }
  return [...newest.values()];
};

/** Recurring payments live with the contacts they pay, in a scope that is never forgotten. */
export const makeRecurringPaymentsRepository = (
  store: LinkyStore,
): RecurringPaymentsRepository => {
  const table = domainTableRepository(store, "contacts", "recurringPayment");
  return {
    ...table,
    all: Effect.map(table.all, toRecords),
    deleted: Effect.map(
      store.copies("contacts", "recurringPayment"),
      (copies) =>
        toRecords(
          newestCopies(copies)
            .filter((row) => row.isDeleted === 1)
            .map((row) => toDomainRow("recurringPayment", row)),
        ),
    ),
  };
};
