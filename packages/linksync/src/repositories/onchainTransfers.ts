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

export type OnchainTransferStoredRow = DomainRow<
  LinkyDbSchema["onchainTransfer"]
>;
export type OnchainTransferInsert = DomainWriteRow<
  LinkyDbSchema["onchainTransfer"]
>;
export type OnchainTransferPatch = DomainPatch<
  LinkyDbSchema["onchainTransfer"]
>;

const requiredColumns = [
  "createdAtSec",
  "role",
  "peerPubkey",
  "direction",
  "amount",
  "feeBasisPoints",
] as const;

/** A transfer row whose columns fixed at creation have all arrived. */
export type OnchainTransferRecord = OnchainTransferStoredRow & {
  readonly [C in (typeof requiredColumns)[number]]: NonNullable<
    OnchainTransferStoredRow[C]
  >;
};

export interface OnchainTransfersRepository extends Omit<
  DomainTableRepository<LinkyDbSchema["onchainTransfer"]>,
  "all"
> {
  /** Complete transfers; a row still arriving column by column is skipped. */
  readonly all: Effect.Effect<ReadonlyArray<OnchainTransferRecord>>;
}

const isComplete = (
  row: OnchainTransferStoredRow,
): row is OnchainTransferRecord =>
  requiredColumns.every((column) => row[column] !== null);

/** On-chain transfers, the user's or the operator's, in a scope that is never forgotten. */
export const makeOnchainTransfersRepository = (
  store: LinkyStore,
): OnchainTransfersRepository => {
  const table = domainTableRepository(store, "onchain", "onchainTransfer");
  return {
    ...table,
    all: Effect.map(table.all, (rows) => rows.filter(isComplete)),
  };
};

export type OnchainTransferMessageRecord = DomainRow<
  LinkyDbSchema["onchainTransferMessage"]
>;
export type OnchainTransferMessageInsert = DomainWriteRow<
  LinkyDbSchema["onchainTransferMessage"]
>;

export type OnchainTransferMessagesRepository = DomainTableRepository<
  LinkyDbSchema["onchainTransferMessage"]
>;

/** On-chain transfer messages the operator received, raw, in the same never-forgotten scope as the transfers. */
export const makeOnchainTransferMessagesRepository = (
  store: LinkyStore,
): OnchainTransferMessagesRepository =>
  domainTableRepository(store, "onchain", "onchainTransferMessage");
