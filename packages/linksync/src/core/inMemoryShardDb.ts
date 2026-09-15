import type { OwnerId, SqliteBoolean, SyncOwner } from "@evolu/common";
import { Clock, Effect } from "effect";
import type {
  Columns,
  DbSchema,
  Mutation,
  OwnerUsage,
  Row,
  ShardDb,
} from "./ShardDb";

export interface InMemoryShardDb<S extends DbSchema> extends ShardDb<S> {
  /** Owners currently opted into sync, for asserting the subscribe set. */
  readonly usedOwners: () => ReadonlyArray<OwnerId>;
}

const rowKey = (ownerId: OwnerId, id: string): string => `${ownerId}/${id}`;

const valueBytes = (value: unknown): number =>
  value === null || value === undefined ? 0 : String(value).length;

const toSqliteBoolean = (value: boolean): SqliteBoolean => (value ? 1 : 0);

export type TableColumns<S extends DbSchema> = {
  readonly [T in keyof S]: ReadonlyArray<keyof S[T] & string>;
};

/**
 * Non-durable, single-process; for tests and quick experiments. Rows are kept
 * per table keyed by `(ownerId, id)`, so it has the same phantom-row
 * behavior as Evolu: an update aimed at the wrong owner creates a new row.
 * `tableColumns` lists each table's columns so a column never written reads
 * back as `null`, the way Evolu returns it.
 */
export const makeInMemoryShardDb = <S extends DbSchema>(
  tableColumns: TableColumns<S>,
): InMemoryShardDb<S> => {
  const tables = new Map<string, Map<string, Row<Columns>>>();
  const usage = new Map<OwnerId, { mutations: number; bytes: number }>();
  const listeners = new Map<string, Set<() => void>>();
  const used = new Map<OwnerId, number>();

  const tableRows = (table: string): Map<string, Row<Columns>> => {
    const existing = tables.get(table);
    if (existing !== undefined) return existing;
    const created = new Map<string, Row<Columns>>();
    tables.set(table, created);
    return created;
  };

  const recordUsage = (ownerId: OwnerId, columns: Columns): void => {
    const current = usage.get(ownerId) ?? { mutations: 0, bytes: 0 };
    const bytes = Object.entries(columns)
      .filter(([column]) => column !== "id")
      .reduce((total, [, value]) => total + valueBytes(value), 0);
    usage.set(ownerId, {
      mutations: current.mutations + 1,
      bytes: current.bytes + bytes,
    });
  };

  const apply = (mutation: Mutation, nowIso: string): void => {
    const rows = tableRows(mutation.table);
    const key = rowKey(mutation.ownerId, mutation.row.id);
    const previous = rows.get(key);
    const { isDeleted, ...columns } =
      mutation.kind === "update"
        ? mutation.row
        : { ...mutation.row, isDeleted: undefined };
    const system = {
      ownerId: mutation.ownerId,
      createdAt: previous?.createdAt ?? nowIso,
      updatedAt: nowIso,
      isDeleted:
        isDeleted === undefined
          ? (previous?.isDeleted ?? null)
          : toSqliteBoolean(isDeleted),
    };
    const unset = Object.fromEntries(
      (tableColumns[mutation.table] ?? [])
        .filter((column) => previous?.[column] === undefined)
        .map((column) => [column, null]),
    );
    rows.set(key, { ...unset, ...previous, ...columns, ...system });
    recordUsage(mutation.ownerId, mutation.row);
  };

  const notify = (table: string): void => {
    for (const listener of listeners.get(table) ?? []) listener();
  };

  // The overload lets the untyped storage satisfy the typed port without a
  // cast; every row in a table's map was written for that table.
  function readTable<T extends keyof S & string>(
    table: T,
  ): Effect.Effect<ReadonlyArray<Row<S[T]>>>;
  function readTable(
    table: string,
  ): Effect.Effect<ReadonlyArray<Row<Columns>>> {
    return Effect.sync(() => [...tableRows(table).values()]);
  }

  return {
    readTable,
    mutate: (mutations) =>
      Effect.map(Clock.currentTimeMillis, (millis) => {
        const nowIso = new Date(millis).toISOString();
        for (const mutation of mutations) apply(mutation, nowIso);
        for (const table of new Set(mutations.map((m) => m.table)))
          notify(table);
      }),
    subscribe: (table, listener) => {
      const set = listeners.get(table) ?? new Set();
      listeners.set(table, set);
      set.add(listener);
      return () => {
        set.delete(listener);
      };
    },
    useOwner: (owner: SyncOwner) => {
      used.set(owner.id, (used.get(owner.id) ?? 0) + 1);
      return () => {
        const count = (used.get(owner.id) ?? 1) - 1;
        if (count <= 0) used.delete(owner.id);
        else used.set(owner.id, count);
      };
    },
    ownerUsage: (ownerId): Effect.Effect<OwnerUsage> =>
      Effect.sync(() => usage.get(ownerId) ?? { mutations: 0, bytes: 0 }),
    deleteOwner: (ownerId) =>
      Effect.sync(() => {
        for (const [table, rows] of tables) {
          for (const [key, row] of rows)
            if (row.ownerId === ownerId) rows.delete(key);
          notify(table);
        }
        usage.delete(ownerId);
      }),
    usedOwners: () => [...used.keys()],
  };
};
