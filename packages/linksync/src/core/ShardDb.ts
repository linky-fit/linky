import type { OwnerId, SqliteBoolean, SyncOwner } from "@evolu/common";
import { Effect, Schema } from "effect";

/**
 * The storage port the shard store runs on. It mirrors what Evolu offers and
 * nothing more: rows partitioned by owner, column-level writes keyed by
 * `(ownerId, id)`, owners opted into sync, and per-owner history usage. The
 * port decides nothing; every shard rule lives in the store.
 *
 * Contract: every read reflects earlier `mutate` calls immediately, even when
 * the underlying database commits later. The store chains writes and reads
 * within one operation and holds no cache of its own.
 */

/** Evolu adds these to every row. `createdAt`/`updatedAt` are ISO strings. */
export interface SystemColumns {
  readonly ownerId: OwnerId;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly isDeleted: SqliteBoolean | null;
}

export type Columns = { readonly id: string } & Readonly<
  Record<string, unknown>
>;

export type DbSchema = Readonly<Record<string, Columns>>;

/**
 * A row as read back. Evolu types every non-id column as nullable, because a
 * row can arrive column by column from sync; readers validate what they need.
 */
export type Row<C extends Columns> = { readonly id: C["id"] } & {
  readonly [K in Exclude<keyof C, "id">]: C[K] | null;
} & SystemColumns;

type NullableKeys<C> = {
  [K in keyof C]: null extends C[K] ? K : never;
}[keyof C];

/** A full row for insert: nullable columns may be omitted (sparse payloads). */
export type WriteRow<C extends Columns> = { readonly id: C["id"] } & {
  readonly [K in Exclude<keyof C, NullableKeys<C> | "id">]: C[K];
} & { readonly [K in NullableKeys<C>]?: C[K] };

export type Patch<C extends Columns> = {
  readonly [K in Exclude<keyof C, "id">]?: C[K];
};

export interface OwnerUsage {
  /** Mutations in the owner's history. */
  readonly mutations: number;
  /** Bytes of column values in the owner's history; a relay-quota estimate. */
  readonly bytes: number;
}

export interface Mutation {
  readonly kind: "upsert" | "update";
  readonly table: string;
  readonly ownerId: OwnerId;
  readonly row: Columns & { readonly isDeleted?: boolean };
}

export interface CopiesWhereOptions {
  /** Match on tombstoned rows too, not only on live ones. */
  readonly matchTombstones?: boolean;
}

/** `readCopiesWhere` over rows already read: every copy of each id with a matching row. */
export const copiesMatching = <R extends Row<Columns>>(
  rows: ReadonlyArray<R>,
  column: string,
  values: ReadonlyArray<string>,
  { matchTombstones = false }: CopiesWhereOptions = {},
): ReadonlyArray<R> => {
  const wanted = new Set<unknown>(values);
  const matched = new Set(
    rows
      .filter(
        (row) =>
          (matchTombstones || row.isDeleted !== 1) && wanted.has(row[column]),
      )
      .map((row) => row.id),
  );
  return rows.filter((row) => matched.has(row.id));
};

// SQLite sorts null first and compares text by code unit, as `String` and `<` do here.
const sortKey = (value: unknown): string =>
  value === null || value === undefined ? "" : String(value);

/** `YYYY-MM-DDTHH:MM:SS`: rows created within one second tie and fall to `thenBy`. */
export const createdSecond = (row: Pick<SystemColumns, "createdAt">): string =>
  row.createdAt.slice(0, 19);

/** `readOldest` over rows already read and filtered by owner. */
export const oldestPerValue = <R extends SystemColumns>(
  rows: ReadonlyArray<R>,
  column: keyof R & string,
  values: ReadonlyArray<string>,
  thenBy: keyof R & string,
): ReadonlyArray<R> => {
  const wanted = new Set<unknown>(values);
  const oldest = new Map<unknown, R>();
  const isOlder = (row: R, than: R): boolean =>
    createdSecond(row) < createdSecond(than) ||
    (createdSecond(row) === createdSecond(than) &&
      sortKey(row[thenBy]) < sortKey(than[thenBy]));
  for (const row of rows) {
    const current = oldest.get(row[column]);
    if (
      wanted.has(row[column]) &&
      (current === undefined || isOlder(row, current))
    )
      oldest.set(row[column], row);
  }
  return [...oldest.values()];
};

export class ShardDbError extends Schema.TaggedError<ShardDbError>()(
  "ShardDbError",
  { table: Schema.String, message: Schema.String },
) {}

export interface ShardDb<S extends DbSchema> {
  /** Every row of the table across all owners, tombstones included. */
  readonly readTable: <T extends keyof S & string>(
    table: T,
  ) => Effect.Effect<ReadonlyArray<Row<S[T]>>>;
  /** Every owner's copy of the rows with these ids, tombstones included. */
  readonly readCopies: <T extends keyof S & string>(
    table: T,
    ids: ReadonlyArray<string>,
  ) => Effect.Effect<ReadonlyArray<Row<S[T]>>>;
  /**
   * Every owner's copy, tombstones included, of each id that has a live row
   * (any row with `matchTombstones`) whose `column` holds one of `values`.
   * All copies of a matched id come back, so a repository's own merge rule
   * still sees every copy.
   */
  readonly readCopiesWhere: <T extends keyof S & string>(
    table: T,
    column: keyof S[T] & string,
    values: ReadonlyArray<string>,
    options?: CopiesWhereOptions,
  ) => Effect.Effect<ReadonlyArray<Row<S[T]>>>;
  /**
   * For each of `values`, the earliest created row among `ownerIds` whose
   * `column` holds it, tombstones included, compared by whole seconds with
   * ties going to the lowest `thenBy`; a value no row holds is absent.
   */
  readonly readOldest: <T extends keyof S & string>(
    table: T,
    column: keyof S[T] & string,
    values: ReadonlyArray<string>,
    ownerIds: ReadonlyArray<OwnerId>,
    thenBy: keyof S[T] & string,
  ) => Effect.Effect<ReadonlyArray<Row<S[T]>>>;
  /**
   * Column-level writes, applied all-or-nothing as one transaction; an
   * `update` of an unknown `(ownerId, id)` creates a row.
   */
  readonly mutate: (
    mutations: ReadonlyArray<Mutation>,
  ) => Effect.Effect<void, ShardDbError>;
  /** Fires after any change to the table, local or synced. */
  readonly subscribe: (
    table: keyof S & string,
    listener: () => void,
  ) => () => void;
  /** Fires after a change to what `readCopiesWhere` with these arguments returns. */
  readonly subscribeWhere: <T extends keyof S & string>(
    table: T,
    column: keyof S[T] & string,
    values: ReadonlyArray<string>,
    listener: () => void,
    options?: CopiesWhereOptions,
  ) => () => void;
  /** Opts the owner into sync; returns the unuse function. */
  readonly useOwner: (owner: SyncOwner) => () => void;
  /**
   * Whether the owner finished a sync round with a relay since the database
   * opened, and `readTable` already returns what that round brought.
   */
  readonly isOwnerSynced: (ownerId: OwnerId) => boolean;
  /** Fires after more owners finished their sync round. */
  readonly subscribeOwnerSync: (listener: () => void) => () => void;
  readonly ownerUsage: (ownerId: OwnerId) => Effect.Effect<OwnerUsage>;
  /** Evolu 7 cannot delete an owner; `null` until the port can. */
  readonly deleteOwner: ((ownerId: OwnerId) => Effect.Effect<void>) | null;
}
