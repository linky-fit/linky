# Core

The generic shard store: no Linky in it. The repositories are its everyday surface; call the store directly to boot it, to add a scope or a port, and for what the repositories do not wrap (`forget`, `rotate`, `ingest`, `copies`, `copiesOf`, `copiesOfIds`, `copiesWhere`, `oldestWhere`, hydration, pointer repair). `copiesWhere` and `oldestWhere` narrow a read through the port's `readCopiesWhere` and `readOldest` ([ports](./ports.md#sharddb)), over the visible shards.

## Scopes

`appScope(tables)` lives in the Evolu `AppOwner`, one fixed partition. `shardScope({ tables, rotation, forget })` lives in `ShardOwner`s derived as `deriveShardOwner(appOwner, [scope, index])`; `rotation: null` pins the scope to index 0, `forget` is `"never"` or `{ keepNewest }`. `keepNewest(scope)` is the number of newest shards a device keeps (`Infinity` for a scope never forgotten); `visibleIndexes(scope, active)` and `forgottenIndexes(scope, active)` are the two pure functions a policy reduces to.

## Creating a store

```ts
import { createShardStore, makeInMemoryShardDb } from "@linky-fit/linksync";

const db = makeInMemoryShardDb<Schema>(tableColumns);
const store = createShardStore<Schema, typeof scopes>({ db, appOwner, scopes });
```

`Schema` maps table name to column types and must include `shardPointer` (`CoreSchema`); pass both type arguments explicitly, they cannot be inferred from the port. `createLinkyStore(db, appOwner, { scopes?, retention?, holdWritesUntilHydrated? })` builds the store over `LinkyDbSchema` with `linkyScopes`; a test passes its own `scopes` for small rotation rules.

Reads and writes are `Effect`s. Errors are `ShardDbError` (the port rejected or never confirmed a write), `RowNotFound` (an id no visible shard holds) and `UnknownScope`. Time comes from Effect's `Clock`, so tests drive the cooldown with a manual clock.

## Lifecycle

1. `reconcileSync()` right after creating the store. Sync uses the app owner plus every visible shard of every scope, and nothing else is subscribed. After reading pointers and tables, `syncOwners()` and `reconcileSync()` revalidate synchronously against persisted retention so a sibling tab's confirmed `forget` cannot be undone by a mid-pass reconciliation re-subscribing a deleted shard.
2. `followPointers(onRotated)` once, kept for the store's lifetime. It reconciles subscriptions on its first read, on every pointer change, and after forgetting, so restored pointers already present when it starts subscribe their shards too. Later pointer changes report local and remote rotations through `onRotated`.
3. Hold every write the user did not ask for until the store is [hydrated](#hydration), and every write on a device that has never been hydrated with the account (`holdWritesUntilHydrated`).
4. `repairPointers()` once, in the background: it waits for hydration and then for the Evolu relay ([pointer repair](#pointer-repair)).
5. `forget(scope?)` only on an explicit user action. It narrows one scope, or every forgettable scope, to its newest window by collecting every shard outside that window that is either still visible or still holds local rows (cleaning up shards left below an existing retention boundary, such as rows migrated from an Evolu 7 database). It unsubscribes and deletes each forgotten shard owner locally in ascending order through `deleteOwner`, advancing persisted retention only after each confirmed deletion. If a deletion fails, previously deleted shards stay forgotten, `reconcileSync()` runs and readers are notified, later shards remain visible, and `forget` fails with `ShardDbError`.

`subscribe(scope, listener)` fires after a change to the scope's tables or pointer and after local or cross-tab forgetting; `subscribeWhere(scope, { table, column, values, matchTombstones? }, listener)` fires for the filtered table only when what `copiesWhere` returns for it changes (and on pointer or visibility changes); `subscribePointers(listener)` fires after any pointer change, local or synced, and after forgetting. When the port signals `onOwnerDeleted`, the store drops that owner's sync handle, advances retention past the confirmed deletion, re-syncs persisted retention across forgettable scopes, and notifies visibility subscribers.

## Hydration

The store is hydrated once the app owner has finished a sync round with an Evolu relay and, after it, every shard its pointers make visible has too (the port's `isOwnerSynced`). Before that, reads show only what the device holds: on a restored device nothing, with every pointer at its provisional index 0. A write made then lands in the wrong shard or hides the account's copies, so background work waits.

- `hydrated` checks now and returns whether the store is hydrated; `subscribeHydration(listener)` fires once when it becomes so. The pair is a `LiveSource` (`useHydrated` in [react](./react.md)).
- It latches: a later rotation or a lost connection does not undo it.
- It needs an Evolu relay to answer. Offline, or while no relay answers, it stays false; nothing times out. A route that has not finished a clean round without failed or skipped changes (`completeAt === null`) has not answered it. A brand-new account hydrates as soon as the relay answers that it holds nothing.
- On hydration the store retains the windows of the forgettable scopes ([retention](#device-local-retention)).
- `ingest` waits for it, so the rows are compared with the account's copies; an ingest of no rows returns at once.
- `holdWritesUntilHydrated: true` in the store options makes every row write (`insert`, `insertRemoved`, `update`, `write`, `remove`) wait for it too. Pass it on a device that has not yet been hydrated with the account, such as right after a restore, where a write before the pointers lands in shard 0 and drops out of view once they arrive; a device that has been hydrated before already holds the pointers and can stay offline-first.
- `openLinkyStore` ([ports](./ports.md#linky-database)) decides both write-holding and no-relay hydration from a device-local marker and `memoryOnly`:
  - `markAwaitingFirstHydration(kv, mnemonic)` writes a fresh unique token to `linky.shards.awaitingFirstHydration.<appOwnerId>` when the device adopts an account (a restore, or before clearing local data); invalid mnemonics write nothing. A persistent store opened over that marker holds writes until it hydrates, then removes the marker only if `kv` still holds the exact token it read at open, so an already-open tab hydrating an older database cannot clear a newer restore or wipe marker.
  - A `memoryOnly` store starts from an empty database: when an Evolu relay is configured (`memoryOnly && hasEvoluRelay`), it holds writes until hydrated without reading or writing retention or removing the marker in `kv`.
  - When no Evolu relay is configured (`hasEvoluRelay: false`), an existing local device (no marker) hydrates immediately; a device with the marker set stays unhydrated so it never hydrates from an empty database.

## Rotation

The store does not schedule the check: every `TableRepository` write ends by starting `maybeRotate`, which reads the shard's history usage after the write has returned, a batch writer runs it once, and of concurrent writes only the first passing check rotates while the rest report `cooldown`. A rotation writes the pointer into the app owner and reconciles sync at once, so the new shard uploads. `rotate(scope)` moves the pointer unconditionally.

## Pointer repair

A pointer is one synced row whose columns merge last-writer-wins, so a device that writes an index from a stale read moves every device's pointer back down, and the shards above it drop out of view. `repairPointers()` undoes that. Once the store is hydrated it checks every rotating scope at once: it syncs the shard above the active index, waits until a relay answered for it, and when the shard holds any row, tombstones included, checks the next one. It then writes the highest such index as a rotation does, `rotatedAtMs` included, and resolves with a `PointerRepair` per moved scope.

- It never moves a pointer down: it writes only an index above the one it reads, and local rotations and repairs write one at a time.
- Probed shards stay subscribed only when they end up visible.
- Offline it waits, with the probed shard subscribed; nothing times out, so run it in the background.
- Like a pointer change from another device, a repair keeps the device's retained window, so a forgettable scope shows the shards in between until `forget`.
- Rows written into the lower shard while the pointer was down stay there; where an id also exists above, the higher shard's copy wins again.

## Ids and owners

Row ids are the caller's: `createId<"Table">()` makes random ones, `createIdFromString<"Table">(text)` derives one from text. `appOwnerFromMnemonic(text)` turns a BIP-39 mnemonic, in any case and spacing, into its Evolu `AppOwner`, or `null` when the text is not a mnemonic; `laneOwnerFromMnemonic(text)` gives the same keys as an owner the database syncs beside its app owner, as the legacy lanes need, because Evolu refuses another `AppOwner`; the owner types (`AppOwner`, `Owner`, `OwnerId`) are re-exported, so a consumer never imports Evolu's owner functions.

## Device-local retention

`ShardRetention` (`get(scope)`, `set(scope, firstIndex)`, both synchronous) persists the first retained index per forgettable scope; the caller namespaces it by app owner and device and never syncs it. `openLinkyStore` keeps it in its `KeyValueStorage` under `linky.shards.retainedFrom.<appOwnerId>.<scope>` for persistent sessions (`memoryOnly` sessions keep retention in memory only). Retention is monotonic across tabs: writing retention never moves a saved index backwards if another tab already advanced it via `forget`, and `visibleShards`, `syncOwners` and `reconcileSync` re-read saved retention synchronously so cross-tab forgets take effect immediately. On the first read of a scope without saved retention, the store discovers the lowest shard holding locally present rows; an empty device's provisional index 0 is not remembered before a local write or [hydration](#hydration) establishes the window.
