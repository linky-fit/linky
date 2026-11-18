# Ports

How the store talks to storage, what a new runtime must implement, and how a Linky app opens its database.

## `ShardDb`

`ShardDb` mirrors what Evolu offers and nothing more: rows partitioned by owner, column-level writes keyed by `(ownerId, id)`, owners opted into sync, which of them finished a sync round, and per-owner history usage. The port decides nothing; every shard rule lives in the store. Rows come back as `Row<Columns>`: the table's columns, every non-id one nullable, plus Evolu's system columns.

Contracts the type cannot express:

- One `mutate` is one transaction: its mutations land together or none does. A copy-forward (copy plus tombstone) and the wallet's proof batches rely on it.
- Read-after-write. The store chains a write and a read inside one operation (copy-on-write reads the current row, the wallet reads the inventory it just changed) and holds no cache, so every read (`readTable`, `readCopies` by ids, `readCopiesWhere`, `readOldest`) that starts after `mutate` resolved returns what it was given. Columns never written read as `null`.
- A `Mutation` carries its `owner` with the write key, which Evolu needs to write under it; the store hands every write the owner of the shard it derived.
- `deleteOwner` is `null` when the runtime cannot delete an owner; `forget` then only unsubscribes and hides the rows (`deleted: false`).
- `isOwnerSynced(ownerId)` turns true once the owner finished a sync round with a relay since the database opened, and only when `readTable` already returns what that round brought; `subscribeOwnerSync` fires when more owners finish. The store's [hydration](./core.md#hydration) rests on it.
- `readCopiesWhere(table, column, values, { matchTombstones })` returns every copy, tombstones included, of each id that has a live copy (any copy with `matchTombstones`) whose `column` holds one of `values`. Returning the other copies too is what lets a repository with its own merge rule narrow a read: a copy-forward leaves a tombstoned copy in the old shard, and a spent mark may sit in any copy. `subscribeWhere` with the same arguments fires when that result changes, so a narrowed read does not listen to the whole table. `readOldest(table, column, values, ownerIds, thenBy)` returns, per value, the earliest created copy among those owners whose `column` holds it, ties going to the lowest `thenBy`.

## In-memory

`makeInMemoryShardDb<Schema>(tableColumns)`: non-durable, single-process, synchronous. It keys rows by `(ownerId, id)` like Evolu, so an update aimed at the wrong owner creates a phantom row, the trap copy-on-write exists to avoid. `tableColumns` lists each table's columns so a never-written column reads back as `null`; for the Linky schema pass `linkyTableColumns`. Its `subscribeWhere` fires on every change to the table. It implements `deleteOwner` and exposes `usedOwners()` for asserting the subscribe set after `reconcileSync()`. There is no relay, so every owner counts as synced; `makeInMemoryShardDb(tableColumns, { holdSync: true })` keeps owners unsynced until `finishSync(ownerId)`, to test what waits for hydration.

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

`createEvoluShardDb(evolu, { syncState, hasEvoluRelay })` from `@linky-fit/linksync/evolu` takes an `EvoluRuntime`, which a `LinkyEvolu` is, and the run's `syncState` store. Evolu 8 stores mutation values without checking them against the schema, so the adapter checks every row of a `mutate` against its table's Evolu types, requires an upsert's non-null columns and refuses a change over `maxMutationSize`, before it queues any: one rejected row fails the call as `ShardDbError` with nothing written. It then queues the rows in one synchronous pass, which Evolu stores as one transaction. A `mutate` resolves on Evolu's `onSuccess`, when subscribed queries already reflect it, and fails as `ShardDbError` with the batch on `onError`; writing it again may succeed. Pass `onWriteFailed` to hear about each failed write and `onWriteApplied` to hear how long each stored write took. `ownerUsage` is measured over `evolu_history`. `deleteOwner` is `null`, so a forgotten shard keeps its local bytes and relay history.

An owner counts as synced once a route of it in Evolu's sync state completed since its worker started, and a fresh query answered after that. Without a relay (`hasEvoluRelay: false`) every owner counts as synced and `useOwner` subscribes nothing, because Evolu syncs nothing then.

## Linky database

`@linky-fit/linksync/evolu` also opens the Linky database itself, so an app only injects its platform pieces.

```ts
import { createEvoluDeps, createRun } from "@evolu/web";
import { linkyScopes } from "@linky-fit/linksync";
import {
  makeEvoluRelaySettings,
  openLinkyEvolu,
  openLinkyStore,
} from "@linky-fit/linksync/evolu";

const relayUrls = makeEvoluRelaySettings(kv, {
  envDefaults,
  recommended,
  hasStoredAccount,
  onEvent,
}).activeUrls();
const run = createRun(createEvoluDeps());
const evolu = await openLinkyEvolu(run, {
  mnemonic,
  relayUrls,
  memoryOnly,
});
const store = await openLinkyStore(evolu, {
  syncState: run.deps.syncState,
  kv,
  scopes: linkyScopes,
  hasEvoluRelay: relayUrls.length > 0,
  onEvent,
});
```

- `kv` is a `KeyValueStorage`: synchronous, device-local `getItem`, `setItem` and `removeItem` that swallow storage failures (a `localStorage` wrapper on the web). The keys the package writes start with `linky.` and never change, because existing devices read them.
- Create the run once per page; its deps hold the `evoluError` and `syncState` stores every instance shares.
- `openLinkyEvolu` opens `LinkyEvoluSchema`, which is `LinkySchema` plus the legacy lane tables and columns only the lane migration reads, under the app name `linky`. With a valid mnemonic it opens the database of the mnemonic's app owner (`createEvolu`); otherwise it opens the app owner Evolu keeps on the device (`createEvoluApp` with instant start), which on its first run is the owner Evolu 7 created. Either way the first open moves the device's Evolu 7 database, named by `generateDbNameFromMnemonic(mnemonic)` (`linky-anon` without a mnemonic), into Evolu 8 and deletes it. The promise resolves before that; the database answers its first query only after the move, which takes long on a big account. `memoryOnly` keeps a mnemonic's database in memory. A database another context holds, such as a tab still on Evolu 7, is refused with `DatabaseHeldError`: through `run.deps.evoluError`, or as the cause of the rejection without a mnemonic. Call it once per page. It indexes the `cashuProof` columns the wallet reads by: `state`, `operationId`, and `keysetId` with `createdAt`.
- `openLinkyStore` creates the store, reconciles sync, follows pointers for the store's lifetime and starts pointer repair in the background, so the caller only keeps the returned store; call it once per database. It applies the [first hydration](./core.md#hydration) marker and keeps [retention](./core.md#device-local-retention) in `kv`.
- `makeEvoluRelaySettings` is the device-local Evolu relay list: the recommended relays (`envDefaults` replaces them when non-empty) followed by the user's, minus the disabled ones. `setUrls` saves the user's list without the recommended relays; `setDisabled` toggles one relay. Creating it migrates the storage of versions before recommended relays once: an existing device (`hasStoredAccount`, or one with a stored legacy selection) keeps the old default relays unless the user had removed them. The recommendation is read once, so a change applies to settings created later; the transports are built at startup, so a changed list applies after a reload. `normalizeEvoluRelayUrl` gives a relay URL's stable identity, or `null` when it is not `ws:` or `wss:`.
- `onEvent` hears a `LinkyEvoluEvent` for what an inspector should show: each relay failure per owner from the sync state, rotations, the owners subscribed at boot and after each rotation, hydration, failed writes, how long each stored write took, pointer repairs and their failure, and the relay migration. The events carry the owner ids to correlate on; turning them into rows is the app's job.
