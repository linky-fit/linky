import { Effect } from "effect";
import type { KeryxSubscriptionRow, LinkyDbSchema } from "../model/schema";
import type { LinkyStore } from "../model/store";
import { tableRepository, type TableRepository } from "./tableRepository";

const requiredColumns = [
  "origin",
  "trustJson",
  "identityJson",
  "channelsJson",
  "pairedAtSec",
] as const;

/** A subscription row whose required columns have all arrived. */
export type KeryxSubscriptionRecord = KeryxSubscriptionRow & {
  readonly [C in (typeof requiredColumns)[number]]: NonNullable<
    KeryxSubscriptionRow[C]
  >;
};

export interface KeryxSubscriptionsRepository extends Omit<
  TableRepository<LinkyDbSchema["keryxSubscription"]>,
  "all"
> {
  /** Complete subscriptions; a row still arriving column by column is skipped. */
  readonly all: Effect.Effect<ReadonlyArray<KeryxSubscriptionRecord>>;
}

const isComplete = (
  row: KeryxSubscriptionRow,
): row is KeryxSubscriptionRecord =>
  requiredColumns.every((column) => row[column] !== null);

/** The user's pairings with companies, in a scope that is never forgotten. */
export const makeKeryxSubscriptionsRepository = (
  store: LinkyStore,
): KeryxSubscriptionsRepository => {
  const table = tableRepository(store, "keryx", "keryxSubscription");
  return {
    ...table,
    all: Effect.map(table.all, (rows) => rows.filter(isComplete)),
  };
};
