/**
 * A scope is one kind of data with one storage policy: which tables it holds,
 * whether it is split into rotating shards, when a shard rotates, and whether
 * old shards may be forgotten. The registry is the source of truth the store
 * runs on; nothing else in the package knows a scope by name.
 */

/** `never`: every shard stays subscribed forever. Otherwise only the newest N. */
export type ForgetPolicy = "never" | { readonly keepNewest: number };

export interface RotationRule {
  /** Rotate once the active shard's history holds at least this many bytes. */
  readonly maxBytes: number;
  /** Rotate once the active shard's history holds at least this many mutations. */
  readonly maxMutations: number;
  /** Minimum time between two rotations of one scope. */
  readonly cooldownMs: number;
}

/** Lives in the app owner: one fixed partition, never rotated or forgotten. */
export interface AppScope<Table extends string> {
  readonly owner: "app";
  readonly tables: ReadonlyArray<Table>;
}

/** Lives in derived shard owners; `rotation: null` pins it to shard 0. */
export interface ShardScope<Table extends string> {
  readonly owner: "shard";
  readonly tables: ReadonlyArray<Table>;
  readonly rotation: RotationRule | null;
  readonly forget: ForgetPolicy;
}

export type ScopeDefinition<Table extends string> =
  | AppScope<Table>
  | ShardScope<Table>;

export type ScopeRegistry<Table extends string = string> = Readonly<
  Record<string, ScopeDefinition<Table>>
>;

export const appScope = <Table extends string>(
  tables: ReadonlyArray<Table>,
): AppScope<Table> => ({ owner: "app", tables });

export const shardScope = <Table extends string>(
  definition: Omit<ShardScope<Table>, "owner">,
): ShardScope<Table> => ({ owner: "shard", ...definition });

const range = (first: number, last: number): ReadonlyArray<number> =>
  first > last
    ? []
    : Array.from({ length: last - first + 1 }, (_, offset) => first + offset);

const firstKeptIndex = (
  scope: ScopeDefinition<string>,
  activeIndex: number,
): number =>
  scope.owner === "shard" && scope.forget !== "never"
    ? Math.max(0, activeIndex - scope.forget.keepNewest + 1)
    : 0;

/** Shard indexes a device reads and syncs: all of them, or the newest N. */
export const visibleIndexes = (
  scope: ScopeDefinition<string>,
  activeIndex: number,
): ReadonlyArray<number> =>
  scope.owner === "app"
    ? [0]
    : range(firstKeptIndex(scope, activeIndex), activeIndex);

/** Shard indexes that fell out of the window and may be deleted. */
export const forgottenIndexes = (
  scope: ScopeDefinition<string>,
  activeIndex: number,
): ReadonlyArray<number> => range(0, firstKeptIndex(scope, activeIndex) - 1);
