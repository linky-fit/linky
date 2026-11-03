import type { PositiveInt } from "@evolu/common";
import { Effect } from "effect";
import type { LinkyDbSchema, ListingRow } from "../model/schema";
import type { LinkyStore } from "../model/store";
import { tableRepository, type TableRepository } from "./tableRepository";

/** A listing row whose columns have all arrived. */
export interface ListingRecord extends Omit<
  ListingRow,
  "amount" | "createdAtSec" | "currency" | "side" | "title" | "unit"
> {
  readonly amount: string;
  readonly createdAtSec: PositiveInt;
  readonly currency: string;
  readonly side: string;
  readonly title: string;
  readonly unit: string;
}

export interface ListingsRepository extends Omit<
  TableRepository<LinkyDbSchema["listing"]>,
  "all"
> {
  /** Rows the app can publish; a row still arriving column by column is skipped. */
  readonly all: Effect.Effect<ReadonlyArray<ListingRecord>>;
}

export const normalizeListing = (row: ListingRow): ListingRecord | null => {
  if (
    row.amount === null ||
    row.createdAtSec === null ||
    row.currency === null ||
    row.side === null ||
    row.title === null ||
    row.unit === null
  ) {
    return null;
  }
  return {
    ...row,
    amount: row.amount,
    createdAtSec: row.createdAtSec,
    currency: row.currency,
    side: row.side,
    title: row.title,
    unit: row.unit,
  };
};

/** Listings live with the contacts they are shared with, in a scope that is never forgotten. */
export const makeListingsRepository = (
  store: LinkyStore,
): ListingsRepository => {
  const table = tableRepository(store, "contacts", "listing");
  return {
    ...table,
    all: Effect.map(table.all, (rows) =>
      rows.flatMap((row) => {
        const record = normalizeListing(row);
        return record === null ? [] : [record];
      }),
    ),
  };
};
