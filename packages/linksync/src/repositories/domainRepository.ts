import {
  sqliteFalse,
  sqliteTrue,
  type Id,
  type OwnerId,
  type SqliteBoolean,
  type StandardSchemaV1,
} from "@evolu/common";
import { Effect } from "effect";
import {
  ShardDbError,
  type Columns,
  type Patch,
  type Row,
  type RowNotFound,
  type WriteRow,
} from "../core";
import {
  LinkySchema,
  linkyTableColumns,
  type LinkyDbSchema,
  type LinkyTable,
} from "../model/schema";
import type { LinkyScope } from "../model/scopes";
import type { LinkyStore } from "../model/store";
import { tableRepository, type TableOf } from "./tableRepository";

/** Plain domain value for an Evolu column type: keeps branded Ids, maps SqliteBoolean to boolean, and unbrands strings and ints. */
export type DomainValue<V> = V extends null
  ? null
  : V extends Id
    ? V
    : V extends SqliteBoolean
      ? boolean
      : V extends string
        ? string
        : V extends number
          ? number
          : V;

/** System metadata every stored record carries. */
export interface RecordMeta {
  readonly ownerId: OwnerId;
  readonly createdAt: string;
  readonly updatedAt: string;
}

type NullableKeys<C> = {
  [K in keyof C]: null extends C[K] ? K : never;
}[keyof C];

/** A row as a repository returns it: clean domain values and system metadata, every non-id column nullable for partial sync. */
export type DomainRow<C extends Columns> = { readonly id: C["id"] } & {
  readonly [K in Exclude<keyof C, "id">]: DomainValue<C[K]> | null;
} & RecordMeta;

/** A full row for insert: clean domain values; nullable columns may be omitted (sparse payloads). */
export type DomainWriteRow<C extends Columns> = { readonly id: C["id"] } & {
  readonly [K in Exclude<keyof C, NullableKeys<C> | "id">]: DomainValue<C[K]>;
} & { readonly [K in NullableKeys<C>]?: DomainValue<C[K]> | undefined };

/** A column-level update patch with clean domain values. */
export type DomainPatch<C extends Columns> = {
  readonly [K in Exclude<keyof C, "id">]?: DomainValue<C[K]> | undefined;
};

/** The shape every domain repository shares: rows merged across shards, writes validated and encoded for Evolu. */
export interface DomainTableRepository<C extends Columns> {
  readonly all: Effect.Effect<ReadonlyArray<DomainRow<C>>>;
  readonly byId: (id: C["id"]) => Effect.Effect<DomainRow<C> | null>;
  /** Writes a live row into the active shard, reviving a removed copy there, then runs `maybeRotate`. */
  readonly insert: (
    row: DomainWriteRow<C>,
  ) => Effect.Effect<void, ShardDbError>;
  /**
   * `insert` unless a visible shard holds a copy with the row's id, live or
   * tombstoned, so a deterministic id neither overwrites later changes nor
   * revives a removed row. Returns whether it wrote.
   */
  readonly insertIfAbsent: (
    row: DomainWriteRow<C>,
  ) => Effect.Effect<boolean, ShardDbError>;
  /**
   * Records the removal of a row that has not arrived: writes the columns
   * given as a tombstone unless a visible shard holds a copy of the id, so a
   * later `insertIfAbsent` of the id is refused. Returns whether it wrote.
   */
  readonly removeIfAbsent: (
    row: { readonly id: C["id"] } & DomainPatch<C>,
  ) => Effect.Effect<boolean, ShardDbError>;
  readonly update: (
    id: C["id"],
    patch: DomainPatch<C>,
  ) => Effect.Effect<void, ShardDbError | RowNotFound>;
  readonly remove: (
    id: C["id"],
  ) => Effect.Effect<void, ShardDbError | RowNotFound>;
  /**
   * The rotation check every write ends with; a batch of raw store writes
   * runs it once. A failed pointer write is logged, never raised: the row
   * is stored either way and the next write repeats the check.
   */
  readonly maybeRotate: Effect.Effect<void>;
  /** Fires after any change to the scope's tables, local or synced. */
  readonly subscribe: (listener: () => void) => () => void;
}

type BooleanColumnMap = {
  readonly [T in LinkyTable]: {
    readonly [K in keyof LinkyDbSchema[T] as NonNullable<
      LinkyDbSchema[T][K]
    > extends SqliteBoolean
      ? K
      : never]: true;
  };
};

// Compile-time verified against `LinkySchema`: adding or removing a SqliteBoolean column updates this map.
const BOOLEAN_COLUMNS = {
  shardPointer: {},
  setting: {},
  nostrIdentity: {},
  contact: { nameSetByUser: true, lnAddressSetByUser: true },
  listing: { priceByAgreement: true },
  hiddenListing: {},
  pinnedListing: {},
  peerListings: {},
  recurringPayment: {},
  conversation: {},
  message: {},
  reaction: {},
  unknownSenderMessage: {},
  cashuProof: {},
  cashuOperation: { locked: true },
  transaction: {},
  keryxSubscription: {},
  onchainTransfer: { refundToSender: true, isTest: true },
  onchainTransferMessage: {},
} satisfies BooleanColumnMap;

/** Converts a raw Evolu row of `table` into its clean domain record (boolean columns decoded, `isDeleted` dropped). */
export function toDomainRow<T extends LinkyTable>(
  table: T,
  row: Row<LinkyDbSchema[T]>,
): DomainRow<LinkyDbSchema[T]>;
export function toDomainRow(
  table: LinkyTable,
  row: Row<Columns>,
): DomainRow<Columns> {
  const boolCols: Readonly<Record<string, true>> = BOOLEAN_COLUMNS[table];
  const out: Record<string, unknown> = {};
  for (const column of linkyTableColumns[table]) {
    if (column === "id") continue;
    const value = row[column];
    out[column] =
      column in boolCols
        ? value === null
          ? null
          : value === sqliteTrue
        : value;
  }
  return {
    ...out,
    id: row.id,
    ownerId: row.ownerId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const encodeColumns = (
  table: LinkyTable,
  input: Readonly<Record<string, unknown>>,
  mode: "insert" | "patch",
): Effect.Effect<Record<string, unknown>, ShardDbError> => {
  const schemaCols: Readonly<Record<string, StandardSchemaV1>> =
    LinkySchema[table];
  const boolCols: Readonly<Record<string, true>> = BOOLEAN_COLUMNS[table];
  const out: Record<string, unknown> = {};
  for (const [column, raw] of Object.entries(input)) {
    if (raw === undefined) continue;
    const colType = schemaCols[column];
    if (colType === undefined) {
      return Effect.fail(
        new ShardDbError({ table, message: `unknown column ${column}` }),
      );
    }
    let wire = raw;
    if (column in boolCols) {
      if (raw !== null && typeof raw !== "boolean") {
        return Effect.fail(
          new ShardDbError({ table, message: `invalid ${column}` }),
        );
      }
      wire = raw === null ? null : raw ? sqliteTrue : sqliteFalse;
    }
    const result = colType["~standard"].validate(wire);
    if (result instanceof Promise || result.issues !== undefined) {
      return Effect.fail(
        new ShardDbError({ table, message: `invalid ${column}` }),
      );
    }
    out[column] = result.value;
  }
  if (mode === "insert") {
    for (const [column, colType] of Object.entries(schemaCols)) {
      if (column in out) continue;
      const result = colType["~standard"].validate(null);
      if (result instanceof Promise || result.issues !== undefined) {
        return Effect.fail(
          new ShardDbError({ table, message: `missing ${column}` }),
        );
      }
    }
  }
  return Effect.succeed(out);
};

function encodeInsert<T extends LinkyTable>(
  table: T,
  input: DomainWriteRow<LinkyDbSchema[T]>,
): Effect.Effect<WriteRow<LinkyDbSchema[T]>, ShardDbError>;
function encodeInsert(
  table: LinkyTable,
  input: { readonly id: string } & Readonly<Record<string, unknown>>,
): Effect.Effect<WriteRow<Columns>, ShardDbError> {
  return Effect.map(encodeColumns(table, input, "insert"), (out) => ({
    id: input.id,
    ...out,
  }));
}

function encodePatch<T extends LinkyTable>(
  table: T,
  input: DomainPatch<LinkyDbSchema[T]>,
): Effect.Effect<Patch<LinkyDbSchema[T]>, ShardDbError>;
function encodePatch(
  table: LinkyTable,
  input: Readonly<Record<string, unknown>>,
): Effect.Effect<Patch<Columns>, ShardDbError> {
  return encodeColumns(table, input, "patch");
}

function encodeRemoveIfAbsent<T extends LinkyTable>(
  table: T,
  input: { readonly id: LinkyDbSchema[T]["id"] } & DomainPatch<
    LinkyDbSchema[T]
  >,
): Effect.Effect<
  { readonly id: LinkyDbSchema[T]["id"] } & Patch<LinkyDbSchema[T]>,
  ShardDbError
>;
function encodeRemoveIfAbsent(
  table: LinkyTable,
  input: { readonly id: string } & Readonly<Record<string, unknown>>,
): Effect.Effect<{ readonly id: string } & Patch<Columns>, ShardDbError> {
  return Effect.map(encodeColumns(table, input, "patch"), (out) => ({
    id: input.id,
    ...out,
  }));
}

/** A domain repository over a single Evolu table: validates and encodes writes, decodes reads. */
export const domainTableRepository = <
  Scope extends LinkyScope,
  T extends TableOf<Scope>,
>(
  store: LinkyStore,
  scope: Scope,
  table: T,
): DomainTableRepository<LinkyDbSchema[T]> => {
  const raw = tableRepository(store, scope, table);
  return {
    all: Effect.map(raw.all, (rows) =>
      rows.map((row) => toDomainRow(table, row)),
    ),
    byId: (id) =>
      Effect.map(raw.byId(id), (row) =>
        row === null ? null : toDomainRow(table, row),
      ),
    insert: (row) => Effect.flatMap(encodeInsert(table, row), raw.insert),
    insertIfAbsent: (row) =>
      Effect.flatMap(encodeInsert(table, row), raw.insertIfAbsent),
    removeIfAbsent: (row) =>
      Effect.flatMap(encodeRemoveIfAbsent(table, row), raw.removeIfAbsent),
    update: (id, patch) =>
      Effect.flatMap(encodePatch(table, patch), (encoded) =>
        raw.update(id, encoded),
      ),
    remove: raw.remove,
    maybeRotate: raw.maybeRotate,
    subscribe: raw.subscribe,
  };
};
