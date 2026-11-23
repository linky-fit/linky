# Ports

How the store talks to storage, what a new runtime must implement, and how a Linky app opens its database.

## `ShardDb`

`ShardDb` mirrors what Evolu offers and nothing more: rows partitioned by owner, column-level writes keyed by `(ownerId, id)`, owners opted into sync, which of them finished a sync round, and per-owner history usage. The port decides nothing; every shard rule lives in the store. Rows come back as `Row<Columns>`: the table's columns, every non-id one nullable, plus Evolu's system columns.

Contracts the type cannot express:

- One `mutate` is one transaction: its mutations land together or none does. A copy-forward (copy plus tombstone) and the wallet's proof batches rely on it.
- Read-after-write. The store chains a write and a read inside one operation (copy-on-write reads the current row, the wallet reads the inventory it just changed) and holds no cache, so every read (`readTable`, `readCopies` by ids, `readCopiesWhere`, `readOldest`) that starts after `mutate` resolved returns what it was given. Columns never written read as `null`.
- A `Mutation` carries its `owner` with the write key, which Evolu needs to write under it; the store hands every write the owner of the shard it derived.
- `deleteOwner(owner)` deletes a shard owner's local rows and history and ends its sync registrations in every tab; optional `onOwnerDeleted` notifies listeners (in this tab or another) so sibling tabs drop their subscriptions and advance their retention past the confirmed deletion.
- `isOwnerSynced(ownerId)` turns true once the owner finished a clean sync round with an Evolu relay since the database opened, and only when `readTable` already returns what that round brought; `subscribeOwnerSync` fires when more owners finish. The store's [hydration](./core.md#hydration) rests on it.
- `readCopiesWhere(table, column, values, { matchTombstones })` returns every copy, tombstones included, of each id that has a live copy (any copy with `matchTombstones`) whose `column` holds one of `values`. Returning the other copies too is what lets a repository with its own merge rule narrow a read: a copy-forward leaves a tombstoned copy in the old shard, and a spent mark may sit in any copy. `subscribeWhere` with the same arguments fires when that result changes, so a narrowed read does not listen to the whole table. `readOldest(table, column, values, ownerIds, thenBy)` returns, per value, the earliest created copy among those owners whose `column` holds it, tombstones included, compared by whole seconds with ties going to the lowest `thenBy`.

## In-memory

`makeInMemoryShardDb<Schema>(tableColumns)`: non-durable, single-process, synchronous. It keys rows by `(ownerId, id)` like Evolu, so an update aimed at the wrong owner creates a phantom row, the trap copy-on-write exists to avoid. `tableColumns` lists each table's columns so a never-written column reads back as `null`; for the Linky schema pass `linkyTableColumns`. Its `subscribeWhere` fires on every change to the table. It implements `deleteOwner` and `onOwnerDeleted`, and exposes `usedOwners()` for asserting the subscribe set after `reconcileSync()`. There is no relay, so every owner counts as synced; `makeInMemoryShardDb(tableColumns, { holdSync: true })` keeps owners unsynced until `finishSync(ownerId)`, to test what waits for hydration.

A consumer's tests build a store over it and hand that to the repositories:

```ts
import {
  createLinkyStore,
  linkyTableColumns,
  makeContactsRepository,
  makeInMemoryShardDb,
} from "@linky-fit/linksync";
import type { LinkyDbSchema } from "@linky-fit/linksync";
import { createAppOwner, OwnerSecret } from "@evolu/common";

const appOwner = createAppOwner(
  OwnerSecret.orThrow(new Uint8Array(32).fill(1)),
);
const db = makeInMemoryShardDb<LinkyDbSchema>(linkyTableColumns);
const store = createLinkyStore(db, appOwner);
const contacts = makeContactsRepository(store);
```

`db.readTable(table)` shows every copy in every shard, which is how a test asserts where a row went. Pass `createLinkyStore` its own `scopes` to test rotation with small thresholds.

## Evolu 8

`createEvoluShardDb(evolu, { syncState, hasEvoluRelay, onOwnerDeleted?, onWriteFailed?, onWriteApplied? })` from `@linky-fit/linksync/evolu` takes an `EvoluRuntime`, which a `LinkyEvolu` is, and the run's `syncState` store.

- **Queries**: table and column names are checked against `LinkySchema`, and targeted reads (`readCopies`, `readCopiesWhere`, `readOldest`) compile through typed `kyselySql` queries (`readCopies` chunks id lists into batches of 500 to stay below SQLite's parameter limit). Rows fill in a missing `createdAt` or `updatedAt` from the other timestamp and drop rows missing both. `subscribe` watches a one-row change digest per table (`evolu_history` latest rowid and timestamp plus the table's row count) instead of subscribing Evolu to `select *`, so mutations do not rescan and diff every live table.
- **Writes**: Evolu 8 stores mutation values without checking them against the schema, so before queueing any row of a `mutate`, the adapter validates every row against its table's Evolu types, rejects unknown tables or columns, requires an upsert's non-null columns, refuses any row over `maxMutationSize`, omits `undefined` columns (so Evolu never throws mid-batch) and maps `isDeleted` booleans to `SqliteBoolean`. One rejected row fails the call as `ShardDbError` with nothing written. Valid rows are queued in one synchronous pass, which Evolu stores as one transaction. A `mutate` resolves on Evolu's `onSuccess` (firing `onWriteApplied` with elapsed time), when subscribed queries already reflect it, and fails as `ShardDbError` with the batch on `onError` (firing `onWriteFailed` with tables, `ownerIds`, row count and error); writing it again may succeed.
- **Usage and owner deletion**: `ownerUsage` queries `evolu_history` by the owner id's bytes. `deleteOwner` delegates to Evolu 8's `evolu.deleteOwner(owner)`, deleting the forgotten shard's local rows and history across tabs while Evolu relay history remains, and turns Evolu errors into `ShardDbError`. Pass `onOwnerDeleted` to forward Evolu's cross-tab deletion callbacks into the store.
- **Owner sync**: an owner counts as synced once a writable route of it in `syncState` finished a clean sync round (`completeAt !== null`) since its worker started and every table query read so far was reloaded afresh (`cache: false`) after that (sync state and query refreshes arrive on separate channels; if a fresh reload fails, the owner stays unsynced until the next sync state update). A `Settled` route with `completeAt === null` skipped at least one change and does not unlock hydration. Without an Evolu relay (`hasEvoluRelay: false`), `useOwner` subscribes nothing and `isOwnerSynced` stays `false`; `openLinkyStore` decides whether an existing local device hydrates without a relay.

## Linky database

`@linky-fit/linksync/evolu` also opens the Linky database itself, so an app only injects its platform pieces. For apps with a stored Evolu mnemonic, `openLinkyDatabase` runs the full boot sequence below in one call; when you need `memoryOnly`, an optional mnemonic, or direct access to `LinkyEvolu`, call the steps in order:

```ts
import { createEvoluDeps, createRun } from "@evolu/web";
import type { OwnerId } from "@linky-fit/linksync";
import { linkyScopes } from "@linky-fit/linksync";
import {
  awaitDatabaseReady,
  makeEvoluRelaySettings,
  openLinkyEvolu,
  openLinkyStore,
  toEvoluTransports,
} from "@linky-fit/linksync/evolu";

const relayUrls = makeEvoluRelaySettings(kv, {
  envDefaults,
  recommended,
  hasStoredAccount,
  onEvent,
}).activeUrls();
const ownerDeletedListeners = new Set<(ownerId: OwnerId) => void>();
const run = createRun(createEvoluDeps());
const evolu = await openLinkyEvolu(run, {
  mnemonic,
  relayUrls,
  memoryOnly,
  onDatabaseDeleted,
  onOwnerDeleted: (ownerId) => {
    for (const listener of ownerDeletedListeners) listener(ownerId);
  },
});
await awaitDatabaseReady(evolu, run.deps.evoluError);
const store = await openLinkyStore(evolu, {
  syncState: run.deps.syncState,
  kv,
  scopes: linkyScopes,
  hasEvoluRelay: toEvoluTransports(relayUrls).length > 0,
  memoryOnly,
  onOwnerDeleted: (listener) => {
    ownerDeletedListeners.add(listener);
    return () => {
      ownerDeletedListeners.delete(listener);
    };
  },
  onEvent,
});
```

- `kv` is a `KeyValueStorage`: synchronous, device-local `getItem`, `setItem` and `removeItem` that swallow storage failures (a `localStorage` wrapper on the web). The keys the package writes start with `linky.` and never change, because existing devices read them.
- Create one `EvoluRun` per page (`createRun(createEvoluDeps())`); its deps hold the `evoluError` and `syncState` stores every instance shares. When `run` exposes `defer`, `openLinkyEvolu` registers the opened instance on `run.defer` so disposing `run` disposes the database before its deps (if registering throws, the opened instance is disposed immediately).
- `openLinkyEvolu` opens `LinkyEvoluSchema` (`LinkySchema` plus the legacy lane tables and columns only the lane migration reads) under the app name `linky`. Call it once per page:
  - Without `memoryOnly`, it checks `run.deps.getDevicePersistence()` first and rejects with `DeviceStorageUnavailableError` when persistent storage is `"NotPersisted"`, instead of silently opening an in-memory database.
  - With a valid `mnemonic`, it opens that mnemonic's `AppOwner` via `createEvolu` with `evolu7Name: generateDbNameFromMnemonic(mnemonic)`. A non-null `mnemonic` that fails parsing throws `InvalidAppMnemonic` instead of opening another owner.
  - With `mnemonic: null` and `memoryOnly: true`, it opens an ephemeral in-memory `AppOwner` via `createEvolu` (`memoryOnly: true`), touching neither persistent storage nor `linky-anon`.
  - With `mnemonic: null` and `memoryOnly: false`, it opens the device's app owner via `createEvoluApp` (`InstantStart`, `evolu7Name: "linky-anon"`).
  - For persistent opens, Evolu 8 moves an existing Evolu 7 database named by `generateDbNameFromMnemonic(mnemonic)` (`linky-anon` for `null` or `""`) into itself on first start and deletes it.
  - Pass `onDatabaseDeleted` (wired for both `createEvolu` and `createEvoluApp`, where it fires when `app.current` replaces the instance) and `onOwnerDeleted` (wired for both).
  - Evolu 8 creates `evolu_<table>_id` automatically; `linkyIndexes` adds the `cashuProof` indexes the wallet queries by (`state`, `operationId`, and `(keysetId, substr("createdAt", 1, 19), mint)`) and `historyTable` on `evolu_history("table")` for the table-change subscription digest.
- `awaitDatabaseReady(evolu, run.deps.evoluError)` waits on an uncached query (which resolves once SQLite and any Evolu 7 import finish) and rejects promptly with `EvoluDatabaseRefusedError` (wrapping `evoluError`) if Evolu reports a startup refusal such as `DatabaseHeldError` or `OtherBuildRunningError`. Use `classifyEvoluOpenError(error)` to map startup failures for recovery screens into `"otherTab"` (`DatabaseHeldError` / `OtherBuildRunningError`), `"storageUnavailable"` (`DeviceStorageUnavailableError`) or `"other"`; handle `InvalidAppMnemonic` explicitly without offering temporary `memoryOnly` storage, which would open the wrong owner.
- `openLinkyStore` creates the store, reconciles sync, follows pointers for the store's lifetime and starts pointer repair in the background, so the caller only keeps the returned store; call it once per database. It enforces [first hydration](./core.md#hydration) (including holding writes when `memoryOnly && hasEvoluRelay` without mutating `kv`), wires `onOwnerDeleted` for cross-tab forgetting, and keeps persistent [retention](./core.md#device-local-retention) in `kv`.
- `openLinkyDatabase` combines `makeEvoluRelaySettings`, `toEvoluTransports`, `openLinkyEvolu` (`memoryOnly: false`), `awaitDatabaseReady`, `onOwnerDeleted` bridging and `openLinkyStore` for apps with a stored mnemonic.
- `toEvoluTransports(urls)` parses and deduplicates valid `ws:` / `wss:` relay URLs into Evolu WebSocket transports; check `toEvoluTransports(relayUrls).length > 0` for `hasEvoluRelay` so it matches the transports Evolu actually uses.
- `syncStateQuotaErrors(syncState, name)` returns every writable owner of the active tenant `name` currently failing a `Pending` route with `ProtocolQuotaError`, so an app can prompt for relay capacity and recover quota-blocked owners.
- `makeEvoluRelaySettings` is the device-local Evolu relay list: the recommended relays (`envDefaults` replaces them when non-empty) followed by the user's, minus the disabled ones. `setUrls` saves the user's list without the recommended relays; `setDisabled` toggles one relay. Creating it migrates the storage of versions before recommended relays once: an existing device (`hasStoredAccount`, or one with a stored legacy selection) keeps the old default relays unless the user had removed them. The recommendation is read once, so a change applies to settings created later; the transports are built at startup, so a changed list applies after a reload. `normalizeEvoluRelayUrl` gives a relay URL's stable identity, or `null` when it is not `ws:` or `wss:`.
- `onEvent` hears a `LinkyEvoluEvent` for what the inspector should show: each distinct relay failure (`Pending` route `failure`) or skipped change (`Settled` route `skippedError`) per writable owner from `syncState`, rotations, the owners subscribed at boot and after each rotation, hydration, owner deletions, failed writes, how long each stored write took, pointer repairs and their failure, and the relay migration. The events carry the owner ids to correlate on; turning them into rows is the app's job.
