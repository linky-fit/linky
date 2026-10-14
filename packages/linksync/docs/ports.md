# Ports

How the store talks to storage, what a new runtime must implement, and how a Linky app opens its database.

## `ShardDb`

`ShardDb` mirrors what Evolu offers and nothing more: rows partitioned by owner, column-level writes keyed by `(ownerId, id)`, owners opted into sync, which of them finished a sync round, and per-owner history usage. The port decides nothing; every shard rule lives in the store. Rows come back as `Row<Columns>`: the table's columns, every non-id one nullable, plus Evolu's system columns.

Two contracts the type cannot express:

- Read-after-write. The store chains a write and a read inside one operation (copy-on-write reads the current row, the wallet reads the inventory it just changed) and holds no cache, so `readTable` and `readCopies` (one row's copies by id) must return what `mutate` was given even when the database commits later.
- `deleteOwner` is `null` when the runtime cannot delete an owner; `forget` then only unsubscribes and hides the rows (`deleted: false`).
- `isOwnerSynced(ownerId)` turns true once the owner finished a sync round with a relay since the database opened, and only when `readTable` already returns what that round brought; `subscribeOwnerSync` fires when more owners finish. The store's [hydration](./core.md#hydration) rests on it.

## In-memory

`makeInMemoryShardDb<Schema>(tableColumns)`: non-durable, single-process, synchronous. It keys rows by `(ownerId, id)` like Evolu, so an update aimed at the wrong owner creates a phantom row, the trap copy-on-write exists to avoid. `tableColumns` lists each table's columns so a never-written column reads back as `null`; for the Linky schema pass `linkyTableColumns`. It implements `deleteOwner` and exposes `usedOwners()` for asserting the subscribe set after `reconcileSync()`. There is no relay, so every owner counts as synced; `makeInMemoryShardDb(tableColumns, { holdSync: true })` keeps owners unsynced until `finishSync(ownerId)`, to test what waits for hydration.

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

## Evolu 7

`createEvoluShardDb(evolu, ownerSync)` from `@linky-fit/linksync/evolu` takes an `EvoluRuntime`: structurally, an Evolu instance whose schema contains `LinkySchema` (a superset is fine). Each row is validated before it is queued, so one rejected row fails as `ShardDbError` instead of failing Evolu's whole mutation batch. A `mutate` resolves once Evolu's worker has applied the batch. Evolu never completes a batch it dropped, so one not applied within ten seconds fails as `ShardDbError` and stops being served from the adapter's read overlay; writing it again may succeed. Pass `onWriteUnconfirmed` in the third argument to hear about each such write. A read (`readTable`, `readCopies`, `ownerUsage`) the worker has not answered within ten seconds fails as `ShardDbError` too. Evolu keeps one `loadQuery` promise per query and sends the query to its worker only when it creates that promise, so until the unanswered query answers, the adapter reads with a variant of it that matches the same rows; a retried read therefore reaches the worker. The query that marks an owner synced is not bounded: an owner counts as synced only once the worker has answered. `onSlowCall` in the third argument hears about every write or read the worker took a second or more to answer, once more at the ten-second bound while it is still unanswered, together with the load at that moment (tables the adapter subscribed, the rows they hold, its writes and reads still waiting). `ownerUsage` is measured over `evolu_history`. `deleteOwner` is `null`: a forgotten shard keeps its local bytes and relay history until Evolu can delete an owner.

Evolu 7 syncs in its database worker and tells the page nothing about it, so `ownerSync` needs the worker to come from this package. Run it in the worker module through `@linky-fit/linksync/evolu/worker`, which keeps the store out of the worker bundle, and hand Evolu the page side:

```ts
// evoluDb.worker.ts
import {
  createConsole,
  createRandom,
  createRandomBytes,
  createTime,
  createWebSocket,
} from "@evolu/common";
import { createWasmSqliteDriver } from "@evolu/web";
import { runOwnerSyncDbWorker } from "@linky-fit/linksync/evolu/worker";

runOwnerSyncDbWorker(self, {
  console: createConsole(),
  createSqliteDriver: createWasmSqliteDriver,
  createWebSocket,
  random: createRandom(),
  randomBytes: createRandomBytes(),
  time: createTime(),
});

// page
import { createSharedWebWorker } from "@evolu/web";
import { trackOwnerSync } from "@linky-fit/linksync/evolu";

const { createDbWorker, ownerSync } = trackOwnerSync((name) =>
  createSharedWebWorker(
    name,
    () =>
      new Worker(new URL("./evoluDb.worker.ts", import.meta.url), {
        type: "module",
      }),
  ),
);
const evolu = createEvolu({ ...deps, createDbWorker })(schema, config);
const db = createEvoluShardDb(evolu, ownerSync);
```

Without workers, as on React Native, run the same database worker on the calling thread with `createInProcessOwnerSyncDbWorker` from `@linky-fit/linksync/evolu/worker`, and hand it to `trackOwnerSync` in place of the web worker. Evolu's database work then shares the thread with the UI.

```ts
import {
  createConsole,
  createRandom,
  createRandomBytes,
  createTime,
  createWebSocket,
} from "@evolu/common";
import { trackOwnerSync } from "@linky-fit/linksync/evolu";
import { createInProcessOwnerSyncDbWorker } from "@linky-fit/linksync/evolu/worker";

const { createDbWorker, ownerSync } = trackOwnerSync(() =>
  createInProcessOwnerSyncDbWorker({
    console: createConsole(),
    createSqliteDriver, // e.g. an expo-sqlite driver
    createWebSocket,
    random: createRandom(),
    randomBytes: createRandomBytes(),
    time: createTime(),
  }),
);
```

An owner counts as synced once a relay has finished a sync round for it, and `ownerSync` holds the owners reported since the worker started, so a page that opens later learns them too. An owner whose answers from a relay so far are all protocol errors stays unsynced, so hydration and pointer repair wait for it; `ownerSync.subscribeFailures(listener)` reports each such error while the page is open. The round detection relies on Evolu sending its next request from the microtasks of the response it got, and on the protocol header the worker reads, so every `package.json` pins the Evolu packages to exact versions; recheck both before moving a pin.

## Linky database

`@linky-fit/linksync/evolu` also opens the Linky database itself, so an app only injects its platform pieces.

```ts
import { createSharedWebWorker, evoluWebDeps } from "@evolu/web";
import { linkyScopes } from "@linky-fit/linksync";
import {
  createLinkyEvolu,
  makeEvoluRelaySettings,
  openLinkyStore,
} from "@linky-fit/linksync/evolu";
import { flushSync } from "react-dom";

const relays = makeEvoluRelaySettings(kv, {
  envDefaults,
  recommended,
  hasStoredAccount,
  onEvent,
});
const transports = relays
  .activeUrls()
  .map((url) => ({ type: "WebSocket" as const, url }));
const { evolu, ownerSync } = createLinkyEvolu({
  evoluDeps: { ...evoluWebDeps, flushSync },
  createWorker: (name) =>
    createSharedWebWorker(
      name,
      () =>
        new Worker(new URL("./evoluDb.worker.ts", import.meta.url), {
          type: "module",
        }),
    ),
  mnemonic,
  transports,
  inMemory,
  enableLogging,
  onEvent,
});
const store = await openLinkyStore(evolu, ownerSync, {
  kv,
  scopes: linkyScopes,
  hasEvoluRelay: transports.length > 0,
  onEvent,
});
```

- `kv` is a `KeyValueStorage`: synchronous, device-local `getItem`, `setItem` and `removeItem` that swallow storage failures (a `localStorage` wrapper on the web). The keys the package writes start with `linky.` and never change, because existing devices read them.
- `createLinkyEvolu` wraps the worker with `trackOwnerSync` and opens `LinkyEvoluSchema`, which is `LinkySchema` plus the legacy lane tables and columns only the lane migration reads. The database is named by `generateDbNameFromMnemonic(mnemonic)` (`linky-anon` without a mnemonic) and owned by the mnemonic's app owner; without one Evolu creates its own. Call it once per page: each call starts its own worker tracking.
- `openLinkyStore` resolves once the app owner is known and the local database has answered a query. It creates the store, reconciles sync, follows pointers for the store's lifetime and starts pointer repair in the background, so the caller only keeps the returned store; call it once per database. It rejects with `ShardDbError` when the database does not answer the reads that reconcile sync. It applies the [first hydration](./core.md#hydration) marker and keeps [retention](./core.md#device-local-retention) in `kv`.
- `makeEvoluRelaySettings` is the device-local Evolu relay list: the recommended relays (`envDefaults` replaces them when non-empty) followed by the user's, minus the disabled ones. `setUrls` saves the user's list without the recommended relays; `setDisabled` toggles one relay. Creating it migrates the storage of versions before recommended relays once: an existing device (`hasStoredAccount`, or one with a stored legacy selection) keeps the old default relays unless the user had removed them. The recommendation is read once, so a change applies to settings created later; the transports are built at startup, so a changed list applies after a reload. `normalizeEvoluRelayUrl` gives a relay URL's stable identity, or `null` when it is not `ws:` or `wss:`.
- `onEvent` hears a `LinkyEvoluEvent` for what an inspector should show: relay protocol errors per owner, rotations, the owners subscribed at boot and after each rotation, hydration, unconfirmed writes, slow or unanswered database calls, pointer repairs and their failure, and the relay migration. The events carry the owner ids to correlate on; turning them into rows is the app's job.
