import type { OwnerId, SyncOwner } from "@evolu/common";
import {
  OwnerId as OwnerIdType,
  ownerIdToOwnerIdBytes,
  sqliteFalse,
  sqliteTrue,
} from "@evolu/common";
import { Deferred, Duration, Effect, FiberId } from "effect";
import type {
  Columns,
  Mutation,
  OwnerUsage,
  Row,
  ShardDb,
  SystemColumns,
} from "../core";
import { ShardDbError } from "../core";
import { LinkySchema, type LinkyDbSchema } from "../model/schema";
import type { OwnerSync } from "./ownerSync";

/**
 * The `ShardDb` port over a live Evolu 7 instance: the one place the package
 * touches Evolu's runtime.
 *
 * The port is table-dynamic while Evolu's query builder and mutation types
 * are per-table generics, so the dynamic calls (`createQuery`, `loadQuery`,
 * `subscribeQuery`, `upsert`, `update`) go through untyped references and
 * their results are validated at runtime, the same way the app's `evolu.ts`
 * reads `evolu_history`. Table names are checked against the schema first;
 * Evolu validates every row it is handed.
 *
 * A query result lags a mutation, so an overlay of this adapter's own writes
 * is served until the loaded rows reflect them. That is what lets the store
 * chain a write and a read inside one operation.
 *
 * Evolu runs every mutation queued in one microtask as a single transaction
 * and drops the whole batch when any of them fails validation, so each row is
 * validated (`onlyValidate`) before it is queued. A write resolves once
 * Evolu's worker has applied it (`onComplete`). A batch Evolu drops never
 * completes, so one still unapplied after a bound fails, leaves
 * the overlay and is reported through `onWriteUnconfirmed`.
 *
 * An owner the worker reports synced counts as synced only after a fresh
 * query has answered: the worker answers queries in order, so by then the
 * refresh its sync round triggered has reached the subscribed queries too.
 */

/**
 * What the adapter needs from an Evolu instance: the typed `useOwner` and,
 * through untyped calls, the query and mutation methods. Structural so an app
 * whose schema is a superset of `LinkySchema` can pass its instance.
 */
export interface EvoluRuntime {
  readonly useOwner: (owner: SyncOwner) => () => void;
}

type LinkyTable = keyof LinkyDbSchema & string;

const MAX_WRITE_COMPLETION_WAIT = Duration.seconds(10);

const isTable = (table: string): table is LinkyTable => table in LinkySchema;

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

// Evolu stamps `createdAt` on insert and upsert and `updatedAt` only on
// update, so a row that was never updated reads back with a null `updatedAt`,
// and a row an update created (a tombstone of a row that has not arrived)
// with a null `createdAt`; the port promises both times.
const withChangeTimes = (row: StoredRow): ReadonlyArray<Row<Columns>> => {
  const createdAt = row.createdAt ?? row.updatedAt;
  const updatedAt = row.updatedAt ?? row.createdAt;
  return createdAt === null || updatedAt === null
    ? []
    : [{ ...row, createdAt, updatedAt }];
};

const isMutationResult = (
  value: unknown,
): value is
  | { readonly ok: true }
  | { readonly ok: false; readonly error: unknown } =>
  typeof value === "object" &&
  value !== null &&
  typeof Reflect.get(value, "ok") === "boolean";

type UntypedRow = Readonly<Record<string, unknown>>;

const isUntypedRow = (value: unknown): value is UntypedRow =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const callUntyped = (
  target: object,
  method: string,
  ...args: ReadonlyArray<string | object>
): unknown => {
  const fn = Reflect.get(target, method);
  if (typeof fn !== "function") throw new Error(`evolu.${method} is missing`);
  return Reflect.apply(fn, target, args);
};

interface UntypedSelect {
  selectFrom: (table: string) => {
    selectAll: () => {
      where: (column: string, op: "=", value: string) => unknown;
    };
  };
}

const overlayKey = (table: string, ownerId: OwnerId, id: string): string =>
  `${table}/${ownerId}/${id}`;

interface OverlayEntry {
  readonly table: string;
  readonly ownerId: OwnerId;
  readonly columns: Columns & { readonly isDeleted?: boolean };
  readonly writtenAtIso: string;
}

const reflects = (loaded: Row<Columns>, entry: OverlayEntry): boolean =>
  Object.entries(entry.columns).every(([column, value]) =>
    column === "isDeleted"
      ? loaded.isDeleted === (value === true ? 1 : 0)
      : loaded[column] === value,
  );

const asRow = (entry: OverlayEntry, previous?: Row<Columns>): Row<Columns> => {
  const { isDeleted, ...columns } = entry.columns;
  return {
    ...previous,
    ...columns,
    ownerId: entry.ownerId,
    createdAt: previous?.createdAt ?? entry.writtenAtIso,
    updatedAt: entry.writtenAtIso,
    isDeleted:
      isDeleted === undefined
        ? (previous?.isDeleted ?? null)
        : isDeleted
          ? 1
          : 0,
  };
};

/** A write Evolu never reported applied within the bound; it may have been dropped. */
export interface UnconfirmedWrite {
  readonly table: string;
  readonly ownerId: OwnerId;
  readonly id: string;
}

export interface EvoluShardDbOptions {
  readonly onWriteUnconfirmed?: (write: UnconfirmedWrite) => void;
}

export const createEvoluShardDb = (
  evolu: EvoluRuntime,
  ownerSync: OwnerSync,
  { onWriteUnconfirmed }: EvoluShardDbOptions = {},
): ShardDb<LinkyDbSchema> => {
  const overlay = new Map<string, OverlayEntry>();
  // Evolu queries are branded strings that Evolu keys its promise cache by;
  // they are passed back exactly as received.
  const queries = new Map<string, string>();

  const asQuery = (value: unknown): string => {
    if (typeof value !== "string")
      throw new Error("evolu.createQuery did not return a query");
    return value;
  };

  const tableQuery = (table: LinkyTable): string => {
    const cached = queries.get(table);
    if (cached !== undefined) return cached;
    const query = asQuery(
      callUntyped(evolu, "createQuery", (db: UntypedSelect) =>
        db.selectFrom(table).selectAll(),
      ),
    );
    queries.set(table, query);
    return query;
  };

  const loadRows = (query: string): Effect.Effect<ReadonlyArray<UntypedRow>> =>
    Effect.promise(async () => {
      const rows = await callUntyped(evolu, "loadQuery", query);
      return Array.isArray(rows) ? rows.filter(isUntypedRow) : [];
    });

  const mergeOverlay = (
    table: string,
    loaded: ReadonlyArray<Row<Columns>>,
    onlyId?: string,
  ): ReadonlyArray<Row<Columns>> => {
    const seen = new Set<string>();
    const merged = loaded.map((row) => {
      const key = overlayKey(table, row.ownerId, row.id);
      seen.add(key);
      const entry = overlay.get(key);
      if (entry === undefined) return row;
      if (reflects(row, entry)) {
        overlay.delete(key);
        return row;
      }
      return asRow(entry, row);
    });
    const pending = [...overlay.values()].filter(
      (entry) =>
        entry.table === table &&
        (onlyId === undefined || entry.columns.id === onlyId) &&
        !seen.has(overlayKey(table, entry.ownerId, entry.columns.id)),
    );
    return [...merged, ...pending.map((entry) => asRow(entry))];
  };

  // The overload lets the untyped Evolu result satisfy the typed port; the
  // table name was validated against the schema and every row was guarded.
  function readTable<T extends LinkyTable>(
    table: T,
  ): Effect.Effect<ReadonlyArray<Row<LinkyDbSchema[T]>>>;
  function readTable(
    table: string,
  ): Effect.Effect<ReadonlyArray<Row<Columns>>> {
    if (!isTable(table)) return Effect.succeed([]);
    return Effect.map(loadRows(tableQuery(table)), (rows) =>
      mergeOverlay(table, rows.filter(isStoredRow).flatMap(withChangeTimes)),
    );
  }

  function readCopies<T extends LinkyTable>(
    table: T,
    id: string,
  ): Effect.Effect<ReadonlyArray<Row<LinkyDbSchema[T]>>>;
  function readCopies(
    table: string,
    id: string,
  ): Effect.Effect<ReadonlyArray<Row<Columns>>> {
    if (!isTable(table)) return Effect.succeed([]);
    const query = asQuery(
      callUntyped(evolu, "createQuery", (db: UntypedSelect) =>
        db.selectFrom(table).selectAll().where("id", "=", id),
      ),
    );
    return Effect.map(loadRows(query), (rows) =>
      mergeOverlay(
        table,
        rows.filter(isStoredRow).flatMap(withChangeTimes),
        id,
      ),
    );
  }

  const record = (mutation: Mutation, nowIso: string): OverlayEntry => {
    const key = overlayKey(mutation.table, mutation.ownerId, mutation.row.id);
    const previous = overlay.get(key);
    const entry: OverlayEntry = {
      table: mutation.table,
      ownerId: mutation.ownerId,
      columns:
        mutation.kind === "upsert"
          ? mutation.row
          : { ...previous?.columns, ...mutation.row },
      writtenAtIso: nowIso,
    };
    overlay.set(key, entry);
    return entry;
  };

  // The port tombstones with a boolean; Evolu's mutation takes its SqliteBoolean.
  const toEvoluRow = (row: Mutation["row"]): Columns => {
    const { isDeleted, ...columns } = row;
    return isDeleted === undefined
      ? columns
      : { ...columns, isDeleted: isDeleted ? sqliteTrue : sqliteFalse };
  };

  interface Queued {
    readonly mutation: Mutation;
    readonly entry: OverlayEntry;
    readonly applied: Effect.Effect<void>;
  }

  /** Queues the mutation at once, so a batch stays one Evolu transaction. */
  const queue = (mutation: Mutation): Effect.Effect<Queued, ShardDbError> => {
    const fail = (message: string) =>
      Effect.fail(new ShardDbError({ table: mutation.table, message }));
    if (!isTable(mutation.table)) return fail("unknown table");
    const row = toEvoluRow(mutation.row);
    const validation = callUntyped(evolu, mutation.kind, mutation.table, row, {
      ownerId: mutation.ownerId,
      onlyValidate: true,
    });
    if (!isMutationResult(validation))
      return fail("unexpected mutation result");
    if (!validation.ok) return fail(JSON.stringify(validation.error));
    const completed = Deferred.unsafeMake<void>(FiberId.none);
    callUntyped(evolu, mutation.kind, mutation.table, row, {
      ownerId: mutation.ownerId,
      onComplete: () => Deferred.unsafeDone(completed, Effect.void),
    });
    const entry = record(mutation, new Date().toISOString());
    return Effect.succeed({
      mutation,
      entry,
      applied: Deferred.await(completed),
    });
  };

  const unconfirm = ({ mutation, entry }: Queued): void => {
    const key = overlayKey(mutation.table, mutation.ownerId, mutation.row.id);
    if (overlay.get(key) === entry) overlay.delete(key);
    onWriteUnconfirmed?.({
      table: mutation.table,
      ownerId: mutation.ownerId,
      id: mutation.row.id,
    });
  };

  const mutate = (
    mutations: ReadonlyArray<Mutation>,
  ): Effect.Effect<void, ShardDbError> =>
    Effect.flatMap(Effect.forEach(mutations, queue), (batch) =>
      Effect.all(
        batch.map(({ applied }) => applied),
        { discard: true },
      ).pipe(
        Effect.timeoutFail({
          duration: MAX_WRITE_COMPLETION_WAIT,
          onTimeout: () =>
            new ShardDbError({
              table: [...new Set(mutations.map(({ table }) => table))].join(
                ",",
              ),
              message: "Evolu did not confirm the write",
            }),
        }),
        Effect.tapError(() => Effect.sync(() => batch.forEach(unconfirm))),
      ),
    );

  // `evolu_history` keys rows by the owner id's bytes, not its base64url text.
  const ownerUsage = (ownerId: OwnerId): Effect.Effect<OwnerUsage> => {
    const query = asQuery(
      callUntyped(evolu, "createQuery", (db: UntypedHistorySelect) =>
        db
          .selectFrom("evolu_history")
          .select((eb) => [
            eb.fn.count("timestamp").distinct().as("mutations"),
            eb.fn.sum(eb.fn("length", ["value"])).as("bytes"),
          ])
          .where("ownerId", "=", ownerIdToOwnerIdBytes(ownerId)),
      ),
    );
    return Effect.map(loadRows(query), (rows) => {
      const first = rows[0];
      const read = (column: string): number => Number(first?.[column] ?? 0);
      return { mutations: read("mutations"), bytes: read("bytes") };
    });
  };

  const readable = new Set<OwnerId>();
  const syncListeners = new Set<() => void>();
  let barriers = 0;
  let absorbing = Promise.resolve();
  const absorbSyncedOwners = (): void => {
    const reported = [...ownerSync.syncedOwners()].filter(
      (ownerId) => !readable.has(ownerId),
    );
    if (reported.length === 0) return;
    barriers += 1;
    const barrier = asQuery(
      callUntyped(evolu, "createQuery", (db: UntypedSelect) =>
        db
          .selectFrom("shardPointer")
          .selectAll()
          .where("id", "=", `linksync-barrier-${barriers}`),
      ),
    );
    const markReadable = () => {
      for (const ownerId of reported) readable.add(ownerId);
      for (const listener of syncListeners) listener();
    };
    absorbing = absorbing
      .then(() => callUntyped(evolu, "loadQuery", barrier))
      .then(markReadable, markReadable);
  };
  ownerSync.subscribe(absorbSyncedOwners);
  absorbSyncedOwners();

  return {
    readTable,
    readCopies,
    mutate,
    subscribe: (table, listener) => {
      const unsubscribe = callUntyped(
        evolu,
        "subscribeQuery",
        tableQuery(table),
      );
      if (typeof unsubscribe !== "function")
        throw new Error("evolu.subscribeQuery did not return a subscriber");
      const stop = unsubscribe(listener);
      return () => {
        if (typeof stop === "function") stop();
      };
    },
    useOwner: (owner: SyncOwner) => evolu.useOwner(owner),
    isOwnerSynced: (ownerId) => readable.has(ownerId),
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

interface UntypedHistorySelect {
  selectFrom: (table: "evolu_history") => {
    select: (
      build: (eb: UntypedExpressionBuilder) => ReadonlyArray<object>,
    ) => { where: (column: string, op: "=", value: Uint8Array) => object };
  };
}

interface UntypedExpressionBuilder {
  readonly fn: {
    count: (column: string) => {
      distinct: () => { as: (alias: string) => object };
    };
    sum: (expression: object) => { as: (alias: string) => object };
    (name: string, args: ReadonlyArray<string>): object;
  };
}
