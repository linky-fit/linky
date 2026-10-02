# Ports

How the store talks to storage, and what a new runtime must implement.

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

`createEvoluShardDb(evolu, ownerSync)` from `@linky-fit/linksync/evolu` takes an `EvoluRuntime`: structurally, an Evolu instance whose schema contains `LinkySchema` (a superset is fine). Each row is validated before it is queued, so one rejected row fails as `ShardDbError` instead of failing Evolu's whole mutation batch. A `mutate` resolves once Evolu's worker has applied the batch. Evolu never completes a batch it dropped, so one not applied within ten seconds fails as `ShardDbError` and stops being served from the adapter's read overlay; writing it again may succeed. Pass `onWriteUnconfirmed` in the third argument to hear about each such write. `ownerUsage` is measured over `evolu_history`. `deleteOwner` is `null`: a forgotten shard keeps its local bytes and relay history until Evolu can delete an owner.

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

An owner counts as synced once a relay has finished a sync round for it, and `ownerSync` holds the owners reported since the worker started, so a page that opens later learns them too. An owner whose answers from a relay so far are all protocol errors stays unsynced, so hydration and pointer repair wait for it; `ownerSync.subscribeFailures(listener)` reports each such error while the page is open. The round detection relies on Evolu sending its next request from the microtasks of the response it got, and on the protocol header the worker reads, so every `package.json` pins the Evolu packages to exact versions; recheck both before moving a pin.
