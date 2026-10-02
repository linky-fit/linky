# Ports

How the store talks to storage, and what a new runtime must implement.

## `ShardDb`

`ShardDb` mirrors what Evolu offers and nothing more: rows partitioned by owner, column-level writes keyed by `(ownerId, id)`, owners opted into sync, which of them finished a sync round, and per-owner history usage. The port decides nothing; every shard rule lives in the store. Rows come back as `Row<Columns>`: the table's columns, every non-id one nullable, plus Evolu's system columns.

Two contracts the type cannot express:

- Read-after-write. The store chains a write and a read inside one operation (copy-on-write reads the current row, the wallet reads the inventory it just changed) and holds no cache, so `readTable` must return what `mutate` was given even when the database commits later.
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

`createEvoluShardDb(evolu, ownerSync)` from `@linky-fit/linksync/evolu` takes an `EvoluRuntime`: structurally, an Evolu instance whose schema contains `LinkySchema` (a superset is fine). Each row is validated before it is queued, so one rejected row fails as `ShardDbError` instead of failing Evolu's whole mutation batch. `ownerUsage` is measured over `evolu_history`. `deleteOwner` is `null`: a forgotten shard keeps its local bytes and relay history until Evolu can delete an owner.

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

The worker reports an owner once a relay has answered every request it sent for that owner and Evolu sent no follow-up: Evolu reconciles in request and response rounds, a relay answers every request, and Evolu 7.4 sends its next request from the microtasks of the response it got. A response carrying a protocol error (a quota, write-key, write or sync error) ends the round as well, since Evolu does not continue from it, but only once that relay has answered the owner without an error since the worker started: what it holds then arrived in the rounds before. An owner whose answers from a relay so far are all errors stays unsynced, so hydration waits for it. `ownerSync.subscribeFailures(listener)` hears each such error while the page is open, with the owner, the error's name and `endsRound`, so a consumer can show why an owner is not synced. `ownerSync` holds the owners reported since the worker started, so a page that opens later learns them too. The port counts a reported owner as synced after one more query has answered, which orders it behind the refresh the sync round triggered. Every `package.json` in the repo pins the Evolu packages to exact versions for this reason; recheck the microtask assumption, and the protocol header the worker reads, before moving a pin: an Evolu that answers asynchronously would report owners early.
