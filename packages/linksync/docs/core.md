# Core

The generic shard store: no Linky in it. The repositories are its everyday surface; call the store directly to boot it, to add a scope or a port, and for what the repositories do not wrap (`forget`, `rotate`, `ingest`, `copies`, hydration).

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
3. Hold every write the user did not ask for until the store is [hydrated](#hydration).
4. `forget(scope?)` only on an explicit user action. It narrows one scope, or every forgettable scope, to its newest window, notifies readers and unsubscribes the rest; it deletes only when the port can.

`subscribe(scope, listener)` fires after a change to the scope's tables or pointer and after explicit forgetting; `subscribePointers(listener)` after any pointer change, local or synced, and after forgetting.

## Hydration

The store is hydrated once the app owner has finished a sync round with a relay and, after it, every shard its pointers make visible has too (the port's `isOwnerSynced`). Before that, reads show only what the device holds: on a restored device nothing, with every pointer at its provisional index 0. A write made then lands in the wrong shard or hides the account's copies, so background work waits.

- `hydrated` checks now and returns whether the store is hydrated; `subscribeHydration(listener)` fires once when it becomes so. The pair is a `LiveSource` (`useHydrated` in [react](./react.md)). `whenHydrated` completes then.
- It latches: a later rotation or a lost connection does not undo it.
- It needs a relay to answer. Offline, or while no relay answers, it stays false and `whenHydrated` waits; nothing times out. A relay whose answers to an owner so far are all protocol errors has not answered it; an error after an error-free answer ends the owner's round. A brand-new account hydrates as soon as the relay answers that it holds nothing. An owner the port syncs with no relay at all counts as synced once used.
- On hydration the store retains the windows of the forgettable scopes ([retention](#device-local-retention)).
- `ingest` waits for it, so the rows are compared with the account's copies; an ingest of no rows returns at once.

## Rotation

The store does not schedule the check: every `TableRepository` write ends with `maybeRotate`, a batch writer runs it once, and of concurrent writes only the first passing check rotates while the rest report `cooldown`. A rotation writes the pointer into the app owner and reconciles sync at once, so the new shard uploads. `rotate(scope)` moves the pointer unconditionally.

## Ids and owners

Row ids are the caller's: `createId<"Table">()` makes random ones, `createIdFromString<"Table">(text)` derives one from text. `appOwnerFromMnemonic(text)` turns a BIP-39 mnemonic into its Evolu `AppOwner`, or `null` when the text is not a mnemonic; the owner types (`AppOwner`, `SyncOwner`, `OwnerId`) are re-exported, so a consumer never imports Evolu's owner functions.

## Device-local retention

`ShardRetention` (`get(scope)`, `set(scope, firstIndex)`, both synchronous) persists the first retained index per forgettable scope; the caller namespaces it by app owner and device and never syncs it. On the first read of a scope the store restores the saved index or discovers it from locally present rows, calls `set` on each change, and retains local writes and later windows until `forget`. An empty device's provisional index 0 is not remembered before a pointer or a local write establishes it, and intermediate indexes seen while the pointers sync are not retained either: the store retains the current windows once it is [hydrated](#hydration).
