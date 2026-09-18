import type { AppOwner, OwnerId, ShardOwner, SyncOwner } from "@evolu/common";
import { createIdFromString, deriveShardOwner } from "@evolu/common";
import { Clock, Effect, Schema } from "effect";
import {
  forgottenIndexes,
  visibleIndexes,
  type ScopeDefinition,
  type ScopeRegistry,
} from "./scope";
import type {
  Columns,
  DbSchema,
  Patch,
  Row,
  ShardDb,
  ShardDbError,
  SystemColumns,
  WriteRow,
} from "./ShardDb";

/** One synced row per scope in the app owner: which shard index is active. */
export type ShardPointerColumns = {
  readonly id: string;
  readonly scope: string;
  readonly index: number;
  readonly rotatedAtMs: number | null;
};

export type CoreSchema = DbSchema & {
  readonly shardPointer: ShardPointerColumns;
};

/** Every device upserts the same pointer row, so the pointer never duplicates. */
export const shardPointerId = (scope: string): string =>
  createIdFromString(`shardPointer/${scope}`);

export interface Shard {
  readonly index: number;
  readonly owner: SyncOwner;
}

export type RotationOutcome =
  | { readonly rotated: true; readonly index: number }
  | {
      readonly rotated: false;
      readonly reason: "fixed" | "belowThreshold" | "cooldown";
    };

/** A scope whose active index moved, on this device or another. */
export interface ShardRotation<Scope extends string = string> {
  readonly scope: Scope;
  readonly index: number;
}

export interface ForgottenShard {
  readonly scope: string;
  readonly index: number;
  readonly deleted: boolean;
}

export class RowNotFound extends Schema.TaggedError<RowNotFound>()(
  "RowNotFound",
  { scope: Schema.String, table: Schema.String, id: Schema.String },
) {}

export class UnknownScope extends Schema.TaggedError<UnknownScope>()(
  "UnknownScope",
  { scope: Schema.String },
) {}

type TableOf<
  R extends ScopeRegistry,
  Scope extends keyof R,
> = R[Scope]["tables"][number];

export interface ShardStore<
  S extends CoreSchema,
  R extends ScopeRegistry<keyof S & string>,
> {
  readonly appOwner: AppOwner;
  /** The pointer's index, or a locally written rotation not yet observed. */
  readonly activeIndex: (scope: keyof R & string) => Effect.Effect<number>;
  readonly shardOwner: (scope: keyof R & string, index: number) => SyncOwner;
  readonly visibleShards: (
    scope: keyof R & string,
  ) => Effect.Effect<ReadonlyArray<Shard>>;
  /** Live rows across the visible shards, one per id, the newest shard's copy. */
  readonly rows: <Scope extends keyof R & string, T extends TableOf<R, Scope>>(
    scope: Scope,
    table: T,
  ) => Effect.Effect<ReadonlyArray<Row<S[T]>>>;
  /**
   * Every copy of every row in the visible shards, tombstones and duplicate
   * ids included, highest shard first: for a repository whose domain has a
   * rule that beats "highest shard wins" (a spent proof anywhere is spent).
   */
  readonly copies: <
    Scope extends keyof R & string,
    T extends TableOf<R, Scope>,
  >(
    scope: Scope,
    table: T,
  ) => Effect.Effect<ReadonlyArray<Row<S[T]>>>;
  /** Writes the row into the active shard. */
  readonly insert: <
    Scope extends keyof R & string,
    T extends TableOf<R, Scope>,
  >(
    scope: Scope,
    table: T,
    row: WriteRow<S[T]>,
  ) => Effect.Effect<void, ShardDbError>;
  /**
   * Copy-on-write: a row in the active shard is patched in place; a row in
   * an older shard is copied whole into the active shard and tombstoned
   * where it was. Old shards therefore stop growing once they retire.
   */
  readonly update: <
    Scope extends keyof R & string,
    T extends TableOf<R, Scope>,
  >(
    scope: Scope,
    table: T,
    id: S[T]["id"],
    patch: Patch<S[T]>,
  ) => Effect.Effect<void, ShardDbError | RowNotFound>;
  /** Tombstones the row where it lives; nothing is copied forward. */
  readonly remove: <
    Scope extends keyof R & string,
    T extends TableOf<R, Scope>,
  >(
    scope: Scope,
    table: T,
    id: S[T]["id"],
  ) => Effect.Effect<void, ShardDbError | RowNotFound>;
  /**
   * Copies rows from outside the scope's shards (a legacy lane, an older
   * app version's owner) into the active shard. Idempotent: a row already
   * present with the same or a newer `updatedAt` is skipped, and a row the
   * shards have tombstoned is not resurrected.
   */
  readonly ingest: <
    Scope extends keyof R & string,
    T extends TableOf<R, Scope>,
  >(
    scope: Scope,
    table: T,
    rows: ReadonlyArray<Row<S[T]>>,
  ) => Effect.Effect<{ readonly ingested: number }, ShardDbError>;
  /** Rows of one owner that is not part of the scope's shards. */
  readonly foreignRows: <T extends keyof S & string>(
    table: T,
    ownerId: OwnerId,
  ) => Effect.Effect<ReadonlyArray<Row<S[T]>>>;
  /** Moves the pointer to the next shard unconditionally. */
  readonly rotate: (
    scope: keyof R & string,
  ) => Effect.Effect<number, ShardDbError | UnknownScope>;
  /** Rotates when the scope's rule says so and the cooldown has passed. */
  readonly maybeRotate: (
    scope: keyof R & string,
  ) => Effect.Effect<RotationOutcome, ShardDbError | UnknownScope>;
  /** The app owner plus every visible shard of every scope. */
  readonly syncOwners: () => Effect.Effect<ReadonlyArray<SyncOwner>>;
  /** Uses the owners in `syncOwners` and unuses the rest. */
  readonly reconcileSync: () => Effect.Effect<void>;
  /** Retains the current windows after initial pointer hydration has settled. */
  readonly retainVisibleShards: () => Effect.Effect<void>;
  /** Shards outside a forgettable scope's window: unsubscribed, deleted when the port can. */
  readonly forget: (
    scope?: keyof R & string,
  ) => Effect.Effect<ReadonlyArray<ForgottenShard>>;
  /** Fires after any change to a table of the scope. */
  readonly subscribe: (
    scope: keyof R & string,
    listener: () => void,
  ) => () => void;
  /** Fires after any change to the pointers, local or synced. */
  readonly subscribePointers: (listener: () => void) => () => void;
  /**
   * Keeps the sync set in step with the pointers: a rotation on another
   * device arrives as a pointer change and subscribes the new shard here.
   * Reports every scope whose active index moved, local rotations included.
   */
  readonly followPointers: (
    onRotated: (rotation: ShardRotation<keyof R & string>) => void,
  ) => () => void;
}

export interface ShardRetention {
  readonly get: (scope: string) => number | undefined;
  readonly set: (scope: string, firstIndex: number) => void;
}

export interface ShardStoreOptions<
  S extends CoreSchema,
  R extends ScopeRegistry<keyof S & string>,
> {
  readonly db: ShardDb<S>;
  readonly appOwner: AppOwner;
  readonly scopes: R;
  readonly retention?: ShardRetention;
}

const SYSTEM_COLUMNS = new Set([
  "ownerId",
  "createdAt",
  "updatedAt",
  "isDeleted",
]);

/** The row without Evolu's system columns: what a copy into another shard writes. */
const columnsOf = (row: Row<Columns>): Columns => ({
  ...Object.fromEntries(
    Object.entries(row).filter(([column]) => !SYSTEM_COLUMNS.has(column)),
  ),
  id: row.id,
});

const isLive = (row: Pick<SystemColumns, "isDeleted">): boolean =>
  row.isDeleted !== 1;

/** One copy per id from the visible shards: the highest shard index wins. */
export const mergeShardRows = <C extends Columns>(
  rows: ReadonlyArray<Row<C>>,
  indexByOwner: ReadonlyMap<OwnerId, number>,
): ReadonlyArray<Row<C>> => {
  const newest = new Map<string, { row: Row<C>; index: number }>();
  for (const row of rows) {
    const index = indexByOwner.get(row.ownerId);
    if (index === undefined) continue;
    const current = newest.get(row.id);
    if (current === undefined || index > current.index)
      newest.set(row.id, { row, index });
  }
  return [...newest.values()].map((entry) => entry.row);
};

export const createShardStore = <
  S extends CoreSchema,
  R extends ScopeRegistry<keyof S & string>,
>(
  options: ShardStoreOptions<S, R>,
): ShardStore<S, R> => {
  const { db, appOwner, scopes } = options;
  const retainedFrom = new Map<string, number>();
  const initialized = new Set<string>();
  const visibilityListeners = new Set<() => void>();
  const retain = (scope: string, first: number) => {
    if (retainedFrom.get(scope) === first) return;
    retainedFrom.set(scope, first);
    options.retention?.set(scope, first);
  };
  const pendingIndex = new Map<string, number>();
  const rotatedLocallyAtMs = new Map<string, number>();
  const rotationInFlight = new Set<string>();
  const shardOwners = new Map<string, ShardOwner>();
  const usedOwners = new Map<OwnerId, () => void>();

  const definition = (scope: string): ScopeDefinition<keyof S & string> => {
    const found = scopes[scope];
    if (found === undefined) throw new UnknownScope({ scope });
    return found;
  };

  const shardOwner = (scope: string, index: number): SyncOwner => {
    if (definition(scope).owner === "app") return appOwner;
    const key = `${scope}/${index}`;
    const cached = shardOwners.get(key);
    if (cached !== undefined) return cached;
    const derived = deriveShardOwner(appOwner, [scope, index]);
    shardOwners.set(key, derived);
    return derived;
  };

  const readPointer = (scope: string) =>
    Effect.map(db.readTable("shardPointer"), (rows) =>
      rows.find(
        (row) =>
          row.ownerId === appOwner.id && row.scope === scope && isLive(row),
      ),
    );

  const activeIndex = (scope: string): Effect.Effect<number> =>
    Effect.map(readPointer(scope), (pointer) => {
      const observed = pointer?.index ?? 0;
      const pending = pendingIndex.get(scope);
      if (pending !== undefined && observed >= pending)
        pendingIndex.delete(scope);
      return Math.max(observed, pending ?? 0);
    });

  const visibleShards = (scope: string): Effect.Effect<ReadonlyArray<Shard>> =>
    Effect.gen(function* () {
      const active = yield* activeIndex(scope);
      const policy = definition(scope);
      const window = visibleIndexes(policy, active);
      if (policy.owner === "app" || policy.forget === "never")
        return window.map((index) => ({
          index,
          owner: shardOwner(scope, index),
        }));
      if (!initialized.has(scope)) {
        const saved = options.retention?.get(scope);
        const localRows = yield* Effect.forEach(policy.tables, (table) =>
          db.readTable(table),
        );
        if (!initialized.has(scope)) {
          initialized.add(scope);
          if (saved !== undefined) retainedFrom.set(scope, saved);
          else {
            const localOwners = new Set(
              localRows.flat().map((row) => row.ownerId),
            );
            for (let index = 0; index <= active; index += 1) {
              if (localOwners.has(shardOwner(scope, index).id)) {
                retain(scope, index);
                break;
              }
            }
          }
        }
      }
      const first = Math.min(retainedFrom.get(scope) ?? active, window[0] ?? 0);

      return Array.from({ length: active - first + 1 }, (_, offset) => {
        const index = first + offset;
        return { index, owner: shardOwner(scope, index) };
      });
    });

  const retainBeforeWrite = (scope: string) =>
    Effect.gen(function* () {
      const shards = yield* visibleShards(scope);
      const policy = definition(scope);
      if (policy.owner === "shard" && policy.forget !== "never")
        retain(scope, shards[0]?.index ?? 0);
    });

  const indexByOwner = (shards: ReadonlyArray<Shard>): Map<OwnerId, number> =>
    new Map(shards.map((shard) => [shard.owner.id, shard.index]));

  const shardCopies = <T extends keyof S & string>(scope: string, table: T) =>
    Effect.map(
      Effect.all([visibleShards(scope), db.readTable(table)]),
      ([shards, all]) => ({
        shards,
        copies: mergeShardRows(all, indexByOwner(shards)),
      }),
    );

  const rows = <T extends keyof S & string>(scope: string, table: T) =>
    Effect.map(shardCopies(scope, table), ({ copies }) =>
      copies.filter(isLive),
    );

  const copies = <T extends keyof S & string>(scope: string, table: T) =>
    Effect.map(
      Effect.all([visibleShards(scope), db.readTable(table)]),
      ([shards, all]) => {
        const index = indexByOwner(shards);
        return all
          .filter((row) => index.has(row.ownerId))
          .sort(
            (a, b) => (index.get(b.ownerId) ?? 0) - (index.get(a.ownerId) ?? 0),
          );
      },
    );

  const activeOwner = (scope: string): Effect.Effect<SyncOwner> =>
    Effect.map(activeIndex(scope), (index) => shardOwner(scope, index));

  const upsertInto = (
    table: string,
    ownerId: OwnerId,
    row: Columns,
  ): Effect.Effect<void, ShardDbError> =>
    db.mutate([{ kind: "upsert", table, ownerId, row }]);

  const locateLive = <T extends keyof S & string>(
    scope: string,
    table: T,
    id: string,
  ): Effect.Effect<Row<S[T]>, RowNotFound> =>
    Effect.flatMap(rows(scope, table), (live) => {
      const found = live.find((row) => row.id === id);
      return found === undefined
        ? Effect.fail(new RowNotFound({ scope, table, id }))
        : Effect.succeed(found);
    });

  const update = <T extends keyof S & string>(
    scope: string,
    table: T,
    id: string,
    patch: Readonly<Record<string, unknown>>,
  ): Effect.Effect<void, ShardDbError | RowNotFound> =>
    Effect.gen(function* () {
      const current = yield* locateLive(scope, table, id);
      yield* retainBeforeWrite(scope);
      const active = yield* activeOwner(scope);
      if (current.ownerId === active.id) {
        yield* db.mutate([
          { kind: "update", table, ownerId: active.id, row: { ...patch, id } },
        ]);
        return;
      }
      yield* db.mutate([
        {
          kind: "upsert",
          table,
          ownerId: active.id,
          row: { ...columnsOf(current), ...patch, id },
        },
        {
          kind: "update",
          table,
          ownerId: current.ownerId,
          row: { id, isDeleted: true },
        },
      ]);
    });

  const remove = <T extends keyof S & string>(
    scope: string,
    table: T,
    id: string,
  ): Effect.Effect<void, ShardDbError | RowNotFound> =>
    Effect.flatMap(locateLive(scope, table, id), (current) =>
      db.mutate([
        {
          kind: "update",
          table,
          ownerId: current.ownerId,
          row: { id, isDeleted: true },
        },
      ]),
    );

  const ingest = <T extends keyof S & string>(
    scope: string,
    table: T,
    incoming: ReadonlyArray<Row<S[T]>>,
  ): Effect.Effect<{ readonly ingested: number }, ShardDbError> =>
    Effect.gen(function* () {
      const { copies } = yield* shardCopies(scope, table);
      const known = new Map(copies.map((row) => [row.id, row]));
      const active = yield* activeOwner(scope);
      const fresh = incoming.filter((row) => {
        if (!isLive(row)) return false;
        const existing = known.get(row.id);
        return existing === undefined || existing.updatedAt < row.updatedAt;
      });
      if (fresh.length > 0) yield* retainBeforeWrite(scope);
      yield* db.mutate(
        fresh.map((row) => ({
          kind: "upsert",
          table,
          ownerId: active.id,
          row: columnsOf(row),
        })),
      );
      return { ingested: fresh.length };
    });

  const writePointer = (
    scope: string,
    index: number,
    nowMs: number,
  ): Effect.Effect<void, ShardDbError> =>
    upsertInto("shardPointer", appOwner.id, {
      id: shardPointerId(scope),
      scope,
      index,
      rotatedAtMs: nowMs,
    });

  const syncOwners = (): Effect.Effect<ReadonlyArray<SyncOwner>> =>
    Effect.map(
      Effect.forEach(Object.keys(scopes), visibleShards),
      (perScope) => {
        const byId = new Map<OwnerId, SyncOwner>([[appOwner.id, appOwner]]);
        for (const shard of perScope.flat())
          byId.set(shard.owner.id, shard.owner);
        return [...byId.values()];
      },
    );

  const reconcileSync = (): Effect.Effect<void> =>
    Effect.map(syncOwners(), (wanted) => {
      const wantedIds = new Set(wanted.map((owner) => owner.id));
      for (const owner of wanted)
        if (!usedOwners.has(owner.id))
          usedOwners.set(owner.id, db.useOwner(owner));
      for (const [id, unuse] of usedOwners)
        if (!wantedIds.has(id)) {
          unuse();
          usedOwners.delete(id);
        }
    });

  const rotate = (
    scope: string,
  ): Effect.Effect<number, ShardDbError | UnknownScope> =>
    Effect.gen(function* () {
      const scopeDefinition = definition(scope);
      if (scopeDefinition.owner === "app" || scopeDefinition.rotation === null)
        return yield* activeIndex(scope);
      yield* retainBeforeWrite(scope);
      const next = (yield* activeIndex(scope)) + 1;
      const nowMs = yield* Clock.currentTimeMillis;
      yield* writePointer(scope, next, nowMs);
      pendingIndex.set(scope, next);
      rotatedLocallyAtMs.set(scope, nowMs);
      yield* reconcileSync();
      return next;
    });

  const maybeRotate = (
    scope: string,
  ): Effect.Effect<RotationOutcome, ShardDbError | UnknownScope> =>
    Effect.gen(function* () {
      const scopeDefinition = definition(scope);
      if (scopeDefinition.owner === "app" || scopeDefinition.rotation === null)
        return { rotated: false, reason: "fixed" };
      const rule = scopeDefinition.rotation;
      const active = yield* activeOwner(scope);
      const usage = yield* db.ownerUsage(active.id);
      if (usage.bytes < rule.maxBytes && usage.mutations < rule.maxMutations)
        return { rotated: false, reason: "belowThreshold" };
      const pointer = yield* readPointer(scope);
      const rotatedAt = [
        pointer?.rotatedAtMs,
        rotatedLocallyAtMs.get(scope),
      ].filter((at): at is number => typeof at === "number");
      const nowMs = yield* Clock.currentTimeMillis;
      if (rotatedAt.some((at) => nowMs - at < rule.cooldownMs))
        return { rotated: false, reason: "cooldown" };
      // Concurrent writes each check the rule; only the first one rotates.
      if (rotationInFlight.has(scope))
        return { rotated: false, reason: "cooldown" };
      rotationInFlight.add(scope);
      return yield* Effect.ensuring(
        Effect.map(
          rotate(scope),
          (index): RotationOutcome => ({ rotated: true, index }),
        ),
        Effect.sync(() => rotationInFlight.delete(scope)),
      );
    });

  const forget = (
    onlyScope?: string,
  ): Effect.Effect<ReadonlyArray<ForgottenShard>> =>
    Effect.gen(function* () {
      const forgotten: ForgottenShard[] = [];
      for (const scope of onlyScope === undefined
        ? Object.keys(scopes)
        : [onlyScope]) {
        const active = yield* activeIndex(scope);
        const indexes = forgottenIndexes(definition(scope), active);
        if (indexes.length === 0) continue;
        retain(scope, indexes.length);
        initialized.add(scope);
        for (const index of indexes) {
          const owner = shardOwner(scope, index);
          if (db.deleteOwner !== null) yield* db.deleteOwner(owner.id);
          forgotten.push({ scope, index, deleted: db.deleteOwner !== null });
        }
      }
      yield* reconcileSync();
      for (const listener of visibilityListeners) listener();
      return forgotten;
    });

  const subscribe = (scope: string, listener: () => void): (() => void) => {
    const notify = () => listener();
    visibilityListeners.add(notify);
    const unsubscribes = [
      ...definition(scope).tables.map((table) => db.subscribe(table, listener)),
      db.subscribe("shardPointer", listener),
    ];
    return () => {
      visibilityListeners.delete(notify);
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  };

  const subscribePointers = (listener: () => void): (() => void) => {
    const notify = () => listener();
    visibilityListeners.add(notify);
    const stop = db.subscribe("shardPointer", listener);
    return () => {
      visibilityListeners.delete(notify);
      stop();
    };
  };

  const scopeNames = Object.keys(scopes).filter(
    (scope): scope is keyof R & string => scope in scopes,
  );

  const followPointers = (
    onRotated: (rotation: ShardRotation<keyof R & string>) => void,
  ): (() => void) => {
    const seen = new Map<string, number>();
    const check = Effect.gen(function* () {
      for (const scope of scopeNames) {
        if (definition(scope).owner === "app") continue;
        const index = yield* activeIndex(scope);
        const previous = seen.get(scope);
        seen.set(scope, index);
        if (previous === undefined || previous === index) continue;
        yield* reconcileSync();
        onRotated({ scope, index });
      }
    });
    // Checks run one after another so two pointer changes cannot interleave.
    let queue = Promise.resolve();
    const enqueue = () => {
      queue = queue.then(() => Effect.runPromise(check));
    };
    enqueue();
    return subscribePointers(enqueue);
  };

  return {
    appOwner,
    activeIndex,
    shardOwner,
    visibleShards,
    rows,
    copies,
    insert: (scope, table, row) =>
      Effect.gen(function* () {
        yield* retainBeforeWrite(scope);
        const owner = yield* activeOwner(scope);
        yield* upsertInto(table, owner.id, row);
      }),
    update,
    remove,
    ingest,
    foreignRows: (table, ownerId) =>
      Effect.map(db.readTable(table), (all) =>
        all.filter((row) => row.ownerId === ownerId),
      ),
    rotate,
    maybeRotate,
    syncOwners,
    reconcileSync,
    retainVisibleShards: () =>
      Effect.forEach(Object.keys(scopes), retainBeforeWrite, { discard: true }),
    forget,
    subscribe,
    subscribePointers,
    followPointers,
  };
};
