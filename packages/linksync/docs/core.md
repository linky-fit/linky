# Core

The generic shard store: no Linky in it. The repositories are its everyday surface; call the store directly to boot it, to add a scope or a port, and for what the repositories do not wrap (`forget`, `rotate`, `ingest`, `copies`).

## Scopes

`appScope(tables)` lives in the Evolu `AppOwner`, one fixed partition. `shardScope({ tables, rotation, forget })` lives in `ShardOwner`s derived as `deriveShardOwner(appOwner, [scope, index])`; `rotation: null` pins the scope to index 0, `forget` is `"never"` or `{ keepNewest }`. `visibleIndexes(scope, active)` and `forgottenIndexes(scope, active)` are the two pure functions a policy reduces to.

## Creating a store

```ts
import { createShardStore, makeInMemoryShardDb } from "@linky-fit/linksync";

const db = makeInMemoryShardDb<Schema>(tableColumns);
const store = createShardStore<Schema, typeof scopes>({ db, appOwner, scopes });
```

`Schema` maps table name to column types and must include `shardPointer` (`CoreSchema`); pass both type arguments explicitly, they cannot be inferred from the port. `createLinkyStore(db, appOwner, { scopes?, retention? })` builds the store over `LinkyDbSchema` with `linkyScopes`; a test passes its own `scopes` for small rotation rules.

Reads and writes are `Effect`s. Errors are `ShardDbError` (the port rejected a write), `RowNotFound` (an id no visible shard holds) and `UnknownScope`. Time comes from Effect's `Clock`, so tests drive the cooldown with a manual clock.

## Lifecycle

1. `reconcileSync()` right after creating the store. Sync uses the app owner plus every visible shard of every scope, and nothing else is subscribed.
2. `followPointers(onRotated)` once, kept for the store's lifetime. A rotation on another device arrives as a pointer change, and this subscription is what subscribes the new shard here; it reports local rotations too.
3. `retainVisibleShards()` once the consumer's initial-sync gate has settled ([retention](#device-local-retention)).
4. `forget(scope?)` only on an explicit user action. It narrows one scope, or every forgettable scope, to its newest window, notifies readers and unsubscribes the rest; it deletes only when the port can.

`subscribe(scope, listener)` fires after a change to the scope's tables or pointer and after explicit forgetting; `subscribePointers(listener)` after any pointer change, local or synced, and after forgetting.

## Rotation

The store does not schedule the check: every `TableRepository` write ends with `maybeRotate`, a batch writer runs it once, and of concurrent writes only the first passing check rotates while the rest report `cooldown`. A rotation writes the pointer into the app owner and reconciles sync at once, so the new shard uploads. `rotate(scope)` moves the pointer unconditionally.

## Ids and owners

Row ids are the caller's: `createId<"Table">()` makes random ones, `createIdFromString<"Table">(text)` derives one from text. `appOwnerFromMnemonic(text)` turns a BIP-39 mnemonic into its Evolu `AppOwner`, or `null` when the text is not a mnemonic; the owner types (`AppOwner`, `SyncOwner`, `OwnerId`) are re-exported, so a consumer never imports Evolu's owner functions.

## Device-local retention

`ShardRetention` (`get(scope)`, `set(scope, firstIndex)`, both synchronous) persists the first retained index per forgettable scope; the caller namespaces it by app owner and device and never syncs it. On the first read of a scope the store restores the saved index or discovers it from locally present rows, calls `set` on each change, and retains local writes and later windows until `forget`. An empty device's provisional index 0 is not remembered before a pointer or a local write establishes it, and intermediate indexes seen during initial pointer hydration are not retained either: Evolu 7 has no initial-sync-complete signal, so once the consumer's own gate settles, call `retainVisibleShards()` once.
