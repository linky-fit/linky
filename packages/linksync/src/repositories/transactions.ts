import type { PositiveInt } from "@evolu/common";
import { Effect } from "effect";
import type { LinkyDbSchema, TransactionRow } from "../model/schema";
import type { LinkyStore } from "../model/store";
import { tableRepository, type TableRepository } from "./tableRepository";

export type TransactionDirection = "in" | "out";
export type TransactionStatus = "declined" | "error" | "ok" | "pending";
export type TransactionCategory = "cashu" | "contacts" | "lightning";

/** A transaction row with its legacy-derived fields normalized. */
export interface TransactionRecord extends Omit<
  TransactionRow,
  "createdAtSec" | "direction" | "status"
> {
  readonly createdAtSec: PositiveInt;
  readonly direction: TransactionDirection;
  readonly status: TransactionStatus;
  readonly category: TransactionCategory;
}

export interface TransactionsRepository extends Omit<
  TableRepository<LinkyDbSchema["transaction"]>,
  "all"
> {
  /** Rows a reader can trust: event time, direction and status valid, category derived. Incomplete synced rows are skipped. */
  readonly all: Effect.Effect<ReadonlyArray<TransactionRecord>>;
}

/** The deprecated `category` column is gone; it was always a function of the method. */
export const deriveTransactionCategory = (
  method: string | null,
): TransactionCategory => {
  if (method === "cashu_chat") return "contacts";
  if (method === "lightning_address" || method === "lightning_invoice")
    return "lightning";
  return "cashu";
};

const readDirection = (value: string | null): TransactionDirection | null =>
  value === "in" || value === "out" ? value : null;

const readStatus = (value: string | null): TransactionStatus | null =>
  value === "declined" ||
  value === "error" ||
  value === "ok" ||
  value === "pending"
    ? value
    : null;

export const normalizeTransaction = (
  row: TransactionRow,
): TransactionRecord | null => {
  const direction = readDirection(row.direction);
  const status = readStatus(row.status);
  if (row.createdAtSec === null || direction === null || status === null)
    return null;
  return {
    ...row,
    createdAtSec: row.createdAtSec,
    direction,
    status,
    category: deriveTransactionCategory(row.method),
  };
};

export const makeTransactionsRepository = (
  store: LinkyStore,
): TransactionsRepository => {
  const table = tableRepository(store, "transactions", "transaction");
  return {
    ...table,
    all: Effect.map(table.all, (rows) =>
      rows.flatMap((row) => {
        const record = normalizeTransaction(row);
        return record === null ? [] : [record];
      }),
    ),
  };
};
