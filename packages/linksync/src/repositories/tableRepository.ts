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
  readonly insert: (row: WriteRow<C>) => Effect.Effect<void, ShardDbError>;
  readonly update: (
    id: C["id"],
    patch: Patch<C>,
  ) => Effect.Effect<void, ShardDbError | RowNotFound>;
  readonly remove: (
    id: C["id"],
  ) => Effect.Effect<void, ShardDbError | RowNotFound>;
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
  return {
    all,
    byId: (id) =>
      Effect.map(all, (rows) => rows.find((row) => row.id === id) ?? null),
    insert: (row) => store.insert(scope, table, row),
    update: (id, patch) => store.update(scope, table, id, patch),
    remove: (id) => store.remove(scope, table, id),
    subscribe: (listener) => store.subscribe(scope, listener),
  };
};
