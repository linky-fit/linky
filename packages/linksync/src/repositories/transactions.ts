import { createIdFromString } from "@evolu/common";
import {
  operationKeyOf,
  type MintUrl,
  type OperationId,
  type ProofId,
  type QuoteId,
} from "@linky-fit/linkshu";
import { Effect } from "effect";
import {
  cashuOperationIdFor,
  type CashuOperationId,
  type TransactionId,
} from "../model/ids";
import type { LinkyDbSchema } from "../model/schema";
import type { LinkyStore } from "../model/store";
import {
  domainTableRepository,
  type DomainPatch,
  type DomainRow,
  type DomainTableRepository,
  type DomainWriteRow,
} from "./domainRepository";

export type TransactionDirection = "in" | "out";
export type TransactionStatus = "declined" | "error" | "ok" | "pending";
export type TransactionCategory = "cashu" | "contacts" | "lightning";

export type TransactionStoredRow = DomainRow<LinkyDbSchema["transaction"]>;
export type TransactionInsert = DomainWriteRow<LinkyDbSchema["transaction"]>;
export type TransactionPatch = DomainPatch<LinkyDbSchema["transaction"]>;

/** A transaction row with its legacy-derived fields normalized. */
export interface TransactionRecord extends Omit<
  TransactionStoredRow,
  "createdAtSec" | "direction" | "status"
> {
  readonly createdAtSec: number;
  readonly direction: TransactionDirection;
  readonly status: TransactionStatus;
  readonly category: TransactionCategory;
}

export interface TransactionsRepository extends Omit<
  DomainTableRepository<LinkyDbSchema["transaction"]>,
  "all"
> {
  /** Rows a reader can trust: event time, direction and status valid, category derived. Incomplete synced rows are skipped. */
  readonly all: Effect.Effect<ReadonlyArray<TransactionRecord>>;
}

/**
 * Deterministic ids: a retry, a second tab or another device recording the
 * same event lands on one row instead of adding another.
 */
export const transactionIdForOperation = (
  operationId: OperationId | CashuOperationId,
): TransactionId =>
  createIdFromString<"Transaction">(`transaction/operation/${operationId}`);

/** A melt or topup known by its quote resolves to the same row as its operation. */
export const transactionIdForQuote = (
  kind: "melt" | "topup",
  mint: MintUrl,
  quoteId: QuoteId,
): TransactionId =>
  transactionIdForOperation(
    cashuOperationIdFor(
      operationKeyOf({ kind, mint, quoteId, tokenText: null }),
    ),
  );

export const transactionIdForRequest = (requestId: string): TransactionId =>
  createIdFromString<"Transaction">(`transaction/request/${requestId}`);

export const transactionIdForRestore = (
  proofIds: ReadonlyArray<ProofId>,
): TransactionId =>
  createIdFromString<"Transaction">(
    `transaction/restore/${[...proofIds].sort().join(",")}`,
  );

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
  row: TransactionStoredRow,
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
  const table = domainTableRepository(store, "transactions", "transaction");
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
