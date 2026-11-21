import { Effect } from "effect";
import type { LinkyDbSchema } from "../model/schema";
import type { LinkyStore } from "../model/store";
import {
  domainTableRepository,
  type DomainPatch,
  type DomainRow,
  type DomainTableRepository,
  type DomainWriteRow,
} from "./domainRepository";

export type KeryxSubscriptionStoredRow = DomainRow<
  LinkyDbSchema["keryxSubscription"]
>;
export type KeryxSubscriptionInsert = DomainWriteRow<
  LinkyDbSchema["keryxSubscription"]
>;
export type KeryxSubscriptionPatch = DomainPatch<
  LinkyDbSchema["keryxSubscription"]
>;

const requiredColumns = [
  "origin",
  "trustJson",
  "identityJson",
  "channelsJson",
  "pairedAtSec",
] as const;

/** A subscription row whose required columns have all arrived. */
export type KeryxSubscriptionRecord = KeryxSubscriptionStoredRow & {
  readonly [C in (typeof requiredColumns)[number]]: NonNullable<
    KeryxSubscriptionStoredRow[C]
  >;
};

export interface KeryxSubscriptionsRepository extends Omit<
  DomainTableRepository<LinkyDbSchema["keryxSubscription"]>,
  "all"
> {
  /** Complete subscriptions; a row still arriving column by column is skipped. */
  readonly all: Effect.Effect<ReadonlyArray<KeryxSubscriptionRecord>>;
}

const isComplete = (
  row: KeryxSubscriptionStoredRow,
): row is KeryxSubscriptionRecord =>
  requiredColumns.every((column) => row[column] !== null);

/** The user's pairings with companies, in a scope that is never forgotten. */
export const makeKeryxSubscriptionsRepository = (
  store: LinkyStore,
): KeryxSubscriptionsRepository => {
  const table = domainTableRepository(store, "keryx", "keryxSubscription");
  return {
    ...table,
    all: Effect.map(table.all, (rows) => rows.filter(isComplete)),
  };
};
