import type { OwnerId, SqliteBoolean, SyncOwner } from "@evolu/common";
import { Effect, Schema } from "effect";

/**
 * The storage port the shard store runs on. It mirrors what Evolu offers and
 * nothing more: rows partitioned by owner, column-level writes keyed by
 * `(ownerId, id)`, owners opted into sync, and per-owner history usage. The
 * port decides nothing; every shard rule lives in the store.
 *
 * Contract: `readTable` reflects earlier `mutate` calls immediately, even when
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

export type Mutation =
  | {
      readonly kind: "upsert";
      readonly table: string;
      readonly ownerId: OwnerId;
      readonly row: Columns;
    }
  | {
      readonly kind: "update";
      readonly table: string;
      readonly ownerId: OwnerId;
      readonly row: Columns & { readonly isDeleted?: boolean };
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
  /** Column-level writes; an `update` of an unknown `(ownerId, id)` creates a row. */
  readonly mutate: (
    mutations: ReadonlyArray<Mutation>,
  ) => Effect.Effect<void, ShardDbError>;
  /** Fires after any change to the table, local or synced. */
  readonly subscribe: (
    table: keyof S & string,
    listener: () => void,
  ) => () => void;
  /** Opts the owner into sync; returns the unuse function. */
  readonly useOwner: (owner: SyncOwner) => () => void;
  readonly ownerUsage: (ownerId: OwnerId) => Effect.Effect<OwnerUsage>;
  /** Evolu 7 cannot delete an owner; `null` until the port can. */
  readonly deleteOwner: ((ownerId: OwnerId) => Effect.Effect<void>) | null;
}
