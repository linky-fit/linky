import { Effect } from "effect";
import type {
  Columns,
  Patch,
  Row,
  RowNotFound,
  ShardDbError,
  WriteRow,
} from "../core";
import type { LinkyDbSchema } from "../model/schema";
import type { LinkyScope, LinkyScopes } from "../model/scopes";
import type { LinkyStore } from "../model/store";

export type TableOf<Scope extends LinkyScope> =
  LinkyScopes[Scope]["tables"][number];

/** The shape every repository shares: rows merged across shards, writes to the active one. */
export interface TableRepository<C extends Columns> {
  readonly all: Effect.Effect<ReadonlyArray<Row<C>>>;
  readonly byId: (id: C["id"]) => Effect.Effect<Row<C> | null>;
  /** Writes into the active shard, then runs `maybeRotate`. */
  readonly insert: (row: WriteRow<C>) => Effect.Effect<void, ShardDbError>;
  readonly update: (
    id: C["id"],
    patch: Patch<C>,
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

export const tableRepository = <
  Scope extends LinkyScope,
  T extends TableOf<Scope>,
>(
  store: LinkyStore,
  scope: Scope,
  table: T,
): TableRepository<LinkyDbSchema[T]> => {
  const all = store.rows(scope, table);
  const maybeRotate = store.maybeRotate(scope).pipe(
    // The scope comes from the registry, so an unknown scope is a defect.
    Effect.catchTag("UnknownScope", (error) => Effect.die(error)),
    Effect.catchTag("ShardDbError", (error) =>
      Effect.logWarning(`shard rotation of ${scope} failed`, error),
    ),
    Effect.asVoid,
  );
  const rotateAfter = <E>(write: Effect.Effect<void, E>) =>
    Effect.zipRight(write, maybeRotate);
  return {
    all,
    byId: (id) =>
      Effect.map(all, (rows) => rows.find((row) => row.id === id) ?? null),
    insert: (row) => rotateAfter(store.insert(scope, table, row)),
    update: (id, patch) => rotateAfter(store.update(scope, table, id, patch)),
    remove: (id) => rotateAfter(store.remove(scope, table, id)),
    maybeRotate,
    subscribe: (listener) => store.subscribe(scope, listener),
  };
};
