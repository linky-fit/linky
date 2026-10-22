import { Effect } from "effect";
import type { LinkyDbSchema, OnchainTransferRow } from "../model/schema";
import type { LinkyStore } from "../model/store";
import { tableRepository, type TableRepository } from "./tableRepository";

const requiredColumns = [
  "createdAtSec",
  "role",
  "peerPubkey",
  "direction",
  "amount",
  "feeBasisPoints",
] as const;

/** A transfer row whose columns fixed at creation have all arrived. */
export type OnchainTransferRecord = OnchainTransferRow & {
  readonly [C in (typeof requiredColumns)[number]]: NonNullable<
    OnchainTransferRow[C]
  >;
};

export interface OnchainTransfersRepository extends Omit<
  TableRepository<LinkyDbSchema["onchainTransfer"]>,
  "all"
> {
  /** Complete transfers; a row still arriving column by column is skipped. */
  readonly all: Effect.Effect<ReadonlyArray<OnchainTransferRecord>>;
}

const isComplete = (row: OnchainTransferRow): row is OnchainTransferRecord =>
  requiredColumns.every((column) => row[column] !== null);

/** On-chain transfers, the user's or the operator's, in a scope that is never forgotten. */
export const makeOnchainTransfersRepository = (
  store: LinkyStore,
): OnchainTransfersRepository => {
  const table = tableRepository(store, "onchain", "onchainTransfer");
  return {
    ...table,
    all: Effect.map(table.all, (rows) => rows.filter(isComplete)),
  };
};
