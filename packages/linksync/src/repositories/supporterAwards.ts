import type { PositiveInt } from "@evolu/common";
import { Effect } from "effect";
import type { LinkyDbSchema, SupporterAwardRow } from "../model/schema";
import type { LinkyStore } from "../model/store";
import { tableRepository, type TableRepository } from "./tableRepository";

/** A supporter award row whose columns have all arrived. */
export interface SupporterAwardRecord extends Omit<
  SupporterAwardRow,
  "awardedAtSec" | "badge" | "eventJson"
> {
  readonly awardedAtSec: PositiveInt;
  readonly badge: string;
  readonly eventJson: string;
}

export interface SupporterAwardsRepository extends Omit<
  TableRepository<LinkyDbSchema["supporterAward"]>,
  "all"
> {
  /** Complete awards; a row still arriving column by column is skipped. */
  readonly all: Effect.Effect<ReadonlyArray<SupporterAwardRecord>>;
}

export const normalizeSupporterAward = (
  row: SupporterAwardRow,
): SupporterAwardRecord | null =>
  row.awardedAtSec === null || row.badge === null || row.eventJson === null
    ? null
    : {
        ...row,
        awardedAtSec: row.awardedAtSec,
        badge: row.badge,
        eventJson: row.eventJson,
      };

/** Supporter badges awarded to the user, in a scope that is never forgotten. */
export const makeSupporterAwardsRepository = (
  store: LinkyStore,
): SupporterAwardsRepository => {
  const table = tableRepository(store, "supporter", "supporterAward");
  return {
    ...table,
    all: Effect.map(table.all, (rows) =>
      rows.flatMap((row) => {
        const record = normalizeSupporterAward(row);
        return record === null ? [] : [record];
      }),
    ),
  };
};
