import type {
  AppOwnerEvolu,
  EvoluSchema,
  LoadQueryOptions,
  Owner,
  OwnerId,
  Query,
  QueryRows,
  ReadonlyStore,
  Row as EvoluRow,
  SyncState,
} from "@evolu/common";
import {
  createQueryBuilder,
  maxMutationSize,
  OwnerId as OwnerIdType,
  ownerIdToOwnerIdBytes,
  sqliteFalse,
  sqliteTrue,
} from "@evolu/common";
import { Duration, Effect } from "effect";
import type {
  Columns,
  CopiesWhereOptions,
  Mutation,
  OwnerUsage,
  Row,
  ShardDb,
  SystemColumns,
} from "../core";
import { ShardDbError } from "../core";
import { oldestPerValue } from "../core/ShardDb";
import { LinkySchema, type LinkyDbSchema } from "../model/schema";
import { LinkyEvoluSchema } from "./linkyEvoluSchema";

/**
 * The `ShardDb` port over a live Evolu 8 instance: the one place the package
 * touches Evolu's runtime.
 *
 * The port is table-dynamic while Evolu's query builder and mutation types
 * are per-table generics, so queries are built and mutations called through
 * untyped references, their results guarded at runtime. Table names are
 * checked against the schema, and every column value against its Evolu type,
 * which Evolu 8 leaves to the app.
 *
 * A write resolves once Evolu reports it stored (`onSuccess`), when its
 * subscribed queries already reflect it, and fails with its whole batch: Evolu
 * stores the mutations queued in one microtask as one transaction.
 *
 * An owner counts as synced once a route of it completed in Evolu's sync state
 * and every table read so far was loaded afresh after that: sync state and
 * query refreshes reach the page on separate channels, in either order.
 */

export type LinkyEvolu = AppOwnerEvolu<typeof LinkyEvoluSchema>;

/**
 * What the adapter needs from the instance. The mutations are called
 * untyped, so any function stands in for them.
 */
export interface EvoluRuntime {
  readonly name: string;
  readonly loadQuery: (
    query: UntypedQuery,
    options?: LoadQueryOptions,
  ) => Promise<QueryRows<EvoluRow>>;
  readonly subscribeQuery: (
    query: UntypedQuery,
  ) => (listener: () => void) => () => void;
  readonly upsert: (...args: never[]) => unknown;
  readonly update: (...args: never[]) => unknown;
  readonly getMutationSize: (...args: never[]) => unknown;
  readonly useOwner: (owner: Owner) => () => void;
}

type LinkyTable = keyof LinkyDbSchema & string;
type UntypedRow = Readonly<Record<string, unknown>>;
type UntypedQuery = Query<typeof LinkyEvoluSchema, EvoluRow>;

const isTable = (table: string): table is LinkyTable => table in LinkySchema;
const schema: EvoluSchema = LinkyEvoluSchema;

const createQuery = createQueryBuilder(LinkyEvoluSchema);

// Evolu's queries are strings; this only brands what `createQuery` returned.
const isQuery = (value: unknown): value is UntypedQuery =>
  typeof value === "string";

const untypedQuery = (
  build: (db: UntypedSelect) => object,
  options?: { readonly prepare: boolean },
): UntypedQuery => {
  const query: unknown = Reflect.apply(createQuery, undefined, [
    build,
    options,
  ]);
  if (!isQuery(query)) throw new Error("createQuery did not return a query");
  return query;
};

type StoredRow = Columns &
  Omit<SystemColumns, "createdAt" | "updatedAt"> & {
    readonly createdAt: string | null;
    readonly updatedAt: string | null;
  };

const isStoredRow = (row: UntypedRow): row is StoredRow =>
  typeof row.id === "string" &&
  OwnerIdType.fromUnknown(row.ownerId).ok &&
  (row.createdAt === null || typeof row.createdAt === "string") &&
  (row.updatedAt === null || typeof row.updatedAt === "string");

// Evolu leaves `updatedAt` null until a change after the row's first one, and
// Evolu 7 left `createdAt` null on a row an update created; the port promises both times.
const withChangeTimes = (row: StoredRow): ReadonlyArray<Row<Columns>> => {
  const createdAt = row.createdAt ?? row.updatedAt;
  const updatedAt = row.updatedAt ?? row.createdAt;
  return createdAt === null || updatedAt === null
    ? []
    : [{ ...row, createdAt, updatedAt }];
};

interface UntypedWhere {
  where: (
    column: string,
    op: "=" | "in" | "is not",
    value: string | number | null | ReadonlyArray<string> | UntypedWhere,
  ) => UntypedWhere;
  orderBy: (
    by: string | ((eb: UntypedOrderExpressions) => object),
  ) => UntypedWhere;
  limit: (count: number) => UntypedWhere;
}

interface UntypedOrderExpressions {
  fn: (name: string, args: ReadonlyArray<object>) => object;
  ref: (column: string) => object;
  lit: (value: number) => object;
}

interface UntypedSelect {
  selectFrom: (table: string) => {
    selectAll: () => UntypedWhere;
    select: (column: string) => UntypedWhere;
  };
}

// Keeps one `in` list's bound parameters far below SQLite's limit.
const ID_CHUNK = 500;

const chunked = <A>(items: ReadonlyArray<A>): ReadonlyArray<ReadonlyArray<A>> =>
  Array.from({ length: Math.ceil(items.length / ID_CHUNK) }, (_, index) =>
    items.slice(index * ID_CHUNK, (index + 1) * ID_CHUNK),
  );

/** A write Evolu could not store, with the rest of its batch. */
export interface FailedWrite {
  readonly tables: ReadonlyArray<string>;
  readonly rows: number;
  readonly error: string;
}

/** A write Evolu stored, with how long it took from queueing to `onSuccess`. */
export interface AppliedWrite {
  readonly tables: ReadonlyArray<string>;
  readonly rows: number;
  readonly durationMs: number;
}

export interface EvoluShardDbOptions {
  readonly syncState: ReadonlyStore<SyncState | null>;
  /** Without a relay every owner counts as synced. */
  readonly hasEvoluRelay: boolean;
  readonly onWriteFailed?: (write: FailedWrite) => void;
  readonly onWriteApplied?: (write: AppliedWrite) => void;
}

/** Owners of the database with a route that completed since its worker started. */
export const completedOwners = (
  state: SyncState | null,
  name: string,
): ReadonlyArray<OwnerId> => {
  const tenant = state?.tenants.find((tenant) => tenant.name === name);
  if (tenant?.type !== "Active") return [];
  return tenant.owners.flatMap((owner) =>
    owner.type === "Writable" &&
    owner.routes.some((route) => route.completeAt !== null)
      ? [owner.ownerId]
      : [],
  );
};

/** Why Evolu must not store the row, or `null` when every value fits its column. */
const rejection = ({ kind, table, row }: Mutation): string | null => {
  const columns = schema[table];
  if (columns === undefined || !isTable(table)) return "unknown table";
  const values: Readonly<Record<string, unknown>> = row;
  for (const [column, type] of Object.entries(columns)) {
    const value = values[column];
    if (value === undefined && kind === "update") continue;
    const result = type["~standard"].validate(
      value === undefined ? null : value,
    );
    if (result instanceof Promise || result.issues !== undefined)
      return `invalid ${column}`;
  }
  const unknown = Object.keys(row).find(
    (column) => column !== "isDeleted" && !(column in columns),
  );
  return unknown === undefined ? null : `unknown column ${unknown}`;
};

// The port tombstones with a boolean; Evolu's mutation takes its SqliteBoolean.
// Evolu throws for an `undefined` column, after it queued the batch's earlier rows.
const toEvoluRow = ({ isDeleted, ...columns }: Mutation["row"]) =>
  Object.fromEntries(
    Object.entries({
      ...columns,
      isDeleted:
        isDeleted === undefined
          ? undefined
          : isDeleted
            ? sqliteTrue
            : sqliteFalse,
    }).filter(([, value]) => value !== undefined),
  );

const tablesOf = (mutations: ReadonlyArray<Mutation>) => [
  ...new Set(mutations.map(({ table }) => table)),
];

export const createEvoluShardDb = (
  evolu: EvoluRuntime,
  {
    syncState,
    hasEvoluRelay,
    onWriteFailed,
    onWriteApplied,
  }: EvoluShardDbOptions,
): ShardDb<LinkyDbSchema> => {
  const tableQueries = new Map<string, UntypedQuery>();
  const tableQuery = (table: LinkyTable): UntypedQuery => {
    const cached = tableQueries.get(table);
    if (cached !== undefined) return cached;
    const query = untypedQuery((db) => db.selectFrom(table).selectAll());
    tableQueries.set(table, query);
    return query;
  };

  // Evolu returns the same result array until the query's rows change.
  const rowsByResult = new WeakMap<object, ReadonlyArray<Row<Columns>>>();
  const loadRows = (
    query: UntypedQuery,
  ): Effect.Effect<ReadonlyArray<Row<Columns>>> =>
    Effect.promise(async () => {
      const result = await evolu.loadQuery(query);
      const cached = rowsByResult.get(result);
      if (cached !== undefined) return cached;
      const rows = result.flatMap((row: UntypedRow) =>
        isStoredRow(row) ? withChangeTimes(row) : [],
      );
      rowsByResult.set(result, rows);
      return rows;
    });

  const loadWhere = (
    build: (db: UntypedSelect) => UntypedWhere,
  ): Effect.Effect<ReadonlyArray<Row<Columns>>> =>
    loadRows(untypedQuery(build, { prepare: true }));

  // The overloads let the untyped Evolu result satisfy the typed port; the
  // table name was validated against the schema and every row was guarded.
  function readTable<T extends LinkyTable>(
    table: T,
  ): Effect.Effect<ReadonlyArray<Row<LinkyDbSchema[T]>>>;
  function readTable(
    table: string,
  ): Effect.Effect<ReadonlyArray<Row<Columns>>> {
    return isTable(table) ? loadRows(tableQuery(table)) : Effect.succeed([]);
  }

  function readCopies<T extends LinkyTable>(
    table: T,
    ids: ReadonlyArray<string>,
  ): Effect.Effect<ReadonlyArray<Row<LinkyDbSchema[T]>>>;
  function readCopies(
    table: string,
    ids: ReadonlyArray<string>,
  ): Effect.Effect<ReadonlyArray<Row<Columns>>> {
    if (!isTable(table) || ids.length === 0) return Effect.succeed([]);
    return Effect.map(
      Effect.forEach(chunked([...new Set(ids)]), (chunk) =>
        loadWhere((db) =>
          db.selectFrom(table).selectAll().where("id", "in", chunk),
        ),
      ),
      (chunks) => chunks.flat(),
    );
  }

  const copiesWhereQuery = (
    table: LinkyTable,
    column: string,
    values: ReadonlyArray<string>,
    { matchTombstones = false }: CopiesWhereOptions = {},
  ): UntypedQuery =>
    untypedQuery((db) => {
      const matching = db
        .selectFrom(table)
        .select("id")
        .where(column, "in", values);
      return db
        .selectFrom(table)
        .selectAll()
        .where(
          "id",
          "in",
          matchTombstones ? matching : matching.where("isDeleted", "is not", 1),
        );
    });

  function readCopiesWhere<T extends LinkyTable>(
    table: T,
    column: keyof LinkyDbSchema[T] & string,
    values: ReadonlyArray<string>,
    options?: CopiesWhereOptions,
  ): Effect.Effect<ReadonlyArray<Row<LinkyDbSchema[T]>>>;
  function readCopiesWhere(
    table: string,
    column: string,
    values: ReadonlyArray<string>,
    options?: CopiesWhereOptions,
  ): Effect.Effect<ReadonlyArray<Row<Columns>>> {
    if (!isTable(table)) return Effect.succeed([]);
    return loadRows(copiesWhereQuery(table, column, values, options));
  }

  function readOldest<T extends LinkyTable>(
    table: T,
    column: keyof LinkyDbSchema[T] & string,
    values: ReadonlyArray<string>,
    ownerIds: ReadonlyArray<OwnerId>,
    thenBy: keyof LinkyDbSchema[T] & string,
  ): Effect.Effect<ReadonlyArray<Row<LinkyDbSchema[T]>>>;
  function readOldest(
    table: string,
    column: string,
    values: ReadonlyArray<string>,
    ownerIds: ReadonlyArray<OwnerId>,
    thenBy: string,
  ): Effect.Effect<ReadonlyArray<Row<Columns>>> {
    if (!isTable(table) || ownerIds.length === 0) return Effect.succeed([]);
    return Effect.map(
      Effect.forEach(values, (value) =>
        loadWhere((db) =>
          db
            .selectFrom(table)
            .selectAll()
            .where(column, "=", value)
            .where("ownerId", "in", ownerIds)
            .where("createdAt", "is not", null)
            .orderBy((eb) =>
              eb.fn("substr", [eb.ref("createdAt"), eb.lit(1), eb.lit(19)]),
            )
            .orderBy(thenBy)
            .limit(1),
        ),
      ),
      (perValue) => oldestPerValue(perValue.flat(), column, values, thenBy),
    );
  }

  // Evolu throws for a mutation over the limit, which would split the batch.
  const tooLarge = ({ table, row }: Mutation): boolean =>
    Number(Reflect.apply(evolu.getMutationSize, evolu, [table, row])) >
    maxMutationSize;

  const queue = (mutation: Mutation): Promise<void> =>
    new Promise((resolve, reject) => {
      Reflect.apply(evolu[mutation.kind], evolu, [
        mutation.table,
        toEvoluRow(mutation.row),
        { owner: mutation.owner, onSuccess: resolve, onError: reject },
      ]);
    });

  /**
   * Validates every mutation before queueing any, then queues them all in
   * one synchronous loop, so the batch is stored whole or not at all.
   */
  const mutate = (
    mutations: ReadonlyArray<Mutation>,
  ): Effect.Effect<void, ShardDbError> =>
    Effect.suspend(() => {
      for (const mutation of mutations) {
        const message =
          rejection(mutation) ?? (tooLarge(mutation) ? "too large" : null);
        if (message !== null)
          return Effect.fail(
            new ShardDbError({ table: mutation.table, message }),
          );
      }
      const stored = Promise.all(mutations.map(queue));
      return Effect.tryPromise({
        try: () => stored,
        catch: (error) =>
          new ShardDbError({
            table: tablesOf(mutations).join(","),
            message: String(error),
          }),
      }).pipe(
        Effect.timed,
        Effect.flatMap(([took]) =>
          Effect.sync(() =>
            onWriteApplied?.({
              tables: tablesOf(mutations),
              rows: mutations.length,
              durationMs: Math.round(Duration.toMillis(took)),
            }),
          ),
        ),
        Effect.tapError((error) =>
          Effect.sync(() =>
            onWriteFailed?.({
              tables: tablesOf(mutations),
              rows: mutations.length,
              error: error.message,
            }),
          ),
        ),
      );
    });

  // `evolu_history` keys rows by the owner id's bytes, not its base64url text.
  const ownerUsage = (ownerId: OwnerId): Effect.Effect<OwnerUsage> => {
    const query = createQuery((db) =>
      db
        .selectFrom("evolu_history")
        .select((eb) => [
          eb.fn.count<number>("timestamp").distinct().as("mutations"),
          eb.fn.sum<number>(eb.fn("length", ["value"])).as("bytes"),
        ])
        .where("ownerId", "=", ownerIdToOwnerIdBytes(ownerId)),
    );
    return Effect.promise(async () => {
      const [first] = await evolu.loadQuery(query);
      return {
        mutations: Number(first?.mutations ?? 0),
        bytes: Number(first?.bytes ?? 0),
      };
    });
  };

  const readable = new Set<OwnerId>();
  const syncListeners = new Set<() => void>();
  let absorbing = Promise.resolve();
  const absorbCompletedOwners = (): void => {
    const completed = completedOwners(syncState.get(), evolu.name).filter(
      (ownerId) => !readable.has(ownerId),
    );
    if (completed.length === 0) return;
    absorbing = absorbing
      .then(() =>
        Promise.all(
          [...tableQueries.values()].map((query) =>
            evolu.loadQuery(query, { cache: false }),
          ),
        ),
      )
      .then(
        () => {
          for (const ownerId of completed) readable.add(ownerId);
          for (const listener of syncListeners) listener();
        },
        // The owners stay unsynced; the next sync state loads again.
        () => {},
      );
  };
  if (hasEvoluRelay) {
    syncState.subscribe(absorbCompletedOwners);
    absorbCompletedOwners();
  }

  const subscribeQuery = (query: UntypedQuery, listener: () => void) =>
    evolu.subscribeQuery(query)(listener);

  return {
    readTable,
    readCopies,
    readCopiesWhere,
    readOldest,
    mutate,
    subscribe: (table, listener) => subscribeQuery(tableQuery(table), listener),
    subscribeWhere: (table, column, values, listener, options) =>
      subscribeQuery(
        copiesWhereQuery(table, column, values, options),
        listener,
      ),
    // Without relays Evolu syncs nothing and `useOwner` would throw.
    useOwner: (owner: Owner) =>
      hasEvoluRelay ? evolu.useOwner(owner) : () => {},
    isOwnerSynced: (ownerId) => !hasEvoluRelay || readable.has(ownerId),
    subscribeOwnerSync: (listener) => {
      syncListeners.add(listener);
      return () => {
        syncListeners.delete(listener);
      };
    },
    ownerUsage,
    deleteOwner: null,
  };
};
