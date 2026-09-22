import type { PositiveInt } from "@evolu/common";
import { Effect } from "effect";
import type { ContactId } from "../model/ids";
import type { LinkyDbSchema, RecurringPaymentRow } from "../model/schema";
import type { LinkyStore } from "../model/store";
import { tableRepository, type TableRepository } from "./tableRepository";

/** A recurring payment row whose schedule and recipient columns have all arrived. */
export interface RecurringPaymentRecord extends Omit<
  RecurringPaymentRow,
  | "amount"
  | "anchorAtSec"
  | "contactId"
  | "createdAtSec"
  | "intervalCount"
  | "intervalUnit"
  | "nextDueAtSec"
  | "unit"
> {
  readonly amount: PositiveInt;
  readonly anchorAtSec: PositiveInt;
  readonly contactId: ContactId;
  readonly createdAtSec: PositiveInt;
  readonly intervalCount: PositiveInt;
  readonly intervalUnit: string;
  readonly nextDueAtSec: PositiveInt;
  readonly unit: string;
}

export interface RecurringPaymentsRepository extends Omit<
  TableRepository<LinkyDbSchema["recurringPayment"]>,
  "all"
> {
  /** Rows the scheduler can act on; a row still arriving column by column is skipped. */
  readonly all: Effect.Effect<ReadonlyArray<RecurringPaymentRecord>>;
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
    row.nextDueAtSec === null ||
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
    nextDueAtSec: row.nextDueAtSec,
    unit: row.unit,
  };
};

/** Recurring payments share the `transactions` scope with the history they produce. */
export const makeRecurringPaymentsRepository = (
  store: LinkyStore,
): RecurringPaymentsRepository => {
  const table = tableRepository(store, "transactions", "recurringPayment");
  return {
    ...table,
    all: Effect.map(table.all, (rows) =>
      rows.flatMap((row) => {
        const record = normalizeRecurringPayment(row);
        return record === null ? [] : [record];
      }),
    ),
  };
};
