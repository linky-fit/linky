# Core

The generic shard store (`src/core`): no Linky in it. Use it directly when adding a scope or a port; the repositories are its everyday surface.

## Scopes

`src/core/scope.ts`. An `appScope(tables)` lives in the Evolu `AppOwner`, one fixed partition. A `shardScope({ tables, rotation, forget })` lives in `ShardOwner`s derived as `deriveShardOwner(appOwner, [scope, index])`; `rotation` is `{ maxBytes, maxMutations, cooldownMs }` or `null` to pin the scope to index 0, and `forget` is `"never"` or `{ keepNewest }`. `visibleIndexes(scope, active)` and `forgottenIndexes(scope, active)` are the two pure functions a policy reduces to.

## The store

```ts
import { createShardStore, makeInMemoryShardDb } from "@linky-fit/linksync";

const db = makeInMemoryShardDb<Schema>(tableColumns);
const store = createShardStore<Schema, typeof scopes>({ db, appOwner, scopes });
```

`Schema` maps table name to column types and must include `shardPointer` (`CoreSchema`); pass both type arguments explicitly, they cannot be inferred from the port. `createLinkyStore(db, appOwner, { scopes?, retention? })` builds the store over `LinkyDbSchema` with `linkyScopes` by default; a test passes its own `scopes` for small rotation rules.

| Member                            | Contract                                                                                                 |
| --------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `appOwner`                        | The `AppOwner` the store was created with.                                                               |
| `shardOwner(scope, index)`        | The `SyncOwner` of one shard, derived synchronously.                                                     |
| `rows(scope, table)`              | Live rows across the visible shards, one per id, the highest shard's copy.                               |
| `copies(scope, table)`            | Every copy in the visible shards, tombstones and duplicates included, highest shard first.               |
| `insert(scope, table, row)`       | Writes into the active shard; nullable columns may be omitted.                                           |
| `update(scope, table, id, patch)` | Copy-on-write; `RowNotFound` for an id no visible shard holds.                                           |
| `remove(scope, table, id)`        | Tombstones the row where it lives; already deleted is a no-op, unknown is `RowNotFound`.                 |
| `ingest(scope, table, rows)`      | Copies foreign rows into the active shard, idempotently; returns how many it wrote.                      |
| `foreignRows(table, ownerId)`     | The rows of one owner, for feeding `ingest`.                                                             |
| `activeIndex(scope)`              | The pointer's index, or a local rotation the read model has not shown yet.                               |
| `visibleShards(scope)`            | `{ index, owner }` for every shard a device reads and syncs.                                             |
| `rotate(scope)`                   | Moves the pointer unconditionally; returns the new index.                                                |
| `maybeRotate(scope)`              | Rotates when the rule and cooldown allow; otherwise reports `fixed`, `belowThreshold` or `cooldown`.     |
| `syncOwners()`                    | The app owner plus every visible shard of every scope.                                                   |
| `reconcileSync()`                 | `useOwner` for owners entering the set, the unuse function for owners leaving it. Call after boot.       |
| `retainVisibleShards()`           | Retains the current windows once initial pointer hydration has settled.                                  |
| `forget(scope?)`                  | Forgets one scope, or all forgettable scopes; notifies readers, unsubscribes, deletes when the port can. |
| `subscribe(scope, listener)`      | Fires after a scope table or pointer changes, or after explicit forgetting.                              |
| `subscribePointers(listener)`     | Fires after a pointer change, local or synced, or explicit forgetting.                                   |
| `followPointers(onRotated)`       | Reconciles sync whenever a pointer moves, here or elsewhere, and reports the scope and new index.        |

Every method returns an `Effect`; errors are `ShardDbError` (the port rejected a write), `RowNotFound` and `UnknownScope`. Time comes from Effect's `Clock`, so tests drive the cooldown with a manual clock.

## Rotation

`maybeRotate` reads the active shard's `ownerUsage` from the port (a fresh shard starts at zero) and rotates when either number reaches the rule and no rotation of the scope happened within `cooldownMs`, judged by the pointer's `rotatedAtMs` and the store's own last rotation. It writes the pointer into the app owner and reconciles sync at once so the new shard uploads. The store does not schedule the check: every `TableRepository` write runs it, a batch writer runs it once, and of concurrent writes only the first passing check rotates while the rest report `cooldown`. A rotation elsewhere arrives as a pointer change; `followPointers` is the one subscription a consumer keeps for the store's lifetime.

## Ids and owners

Row ids are the caller's: `createId<"Table">()` makes random ones, `createIdFromString<"Table">(text)` derives one from text. `appOwnerFromMnemonic(text)` turns a BIP-39 mnemonic into its Evolu `AppOwner`, or `null` when the text is not a mnemonic; the owner types (`AppOwner`, `SyncOwner`, `OwnerId`) are re-exported, so a consumer never imports Evolu's owner functions.

## Device-local retention

`ShardRetention` (`get(scope)`, `set(scope, firstIndex)`, both synchronous) persists the first retained index per forgettable scope; the caller namespaces it by app owner and device and never syncs it. On the first read of a scope the store restores the saved index or discovers it from locally present rows, calls `set` on each change, and retains local writes and later windows until `forget`. An empty device's provisional index 0 is not remembered before a pointer or a local write establishes it, and intermediate indexes seen during initial pointer hydration are not retained either: once the consumer's initial-sync gate settles (Evolu 7 has no initial-sync-complete signal), call `retainVisibleShards()` once.
