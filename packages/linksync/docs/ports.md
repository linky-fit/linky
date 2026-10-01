# Ports

How the store talks to storage, and what a new runtime must implement.

## `ShardDb`

`ShardDb` mirrors what Evolu offers and nothing more: rows partitioned by owner, column-level writes keyed by `(ownerId, id)`, owners opted into sync, and per-owner history usage. The port decides nothing; every shard rule lives in the store. Rows come back as `Row<Columns>`: the table's columns, every non-id one nullable, plus Evolu's system columns.

Two contracts the type cannot express:

- Read-after-write. The store chains a write and a read inside one operation (copy-on-write reads the current row, the wallet reads the inventory it just changed) and holds no cache, so `readTable` must return what `mutate` was given even when the database commits later.
- `deleteOwner` is `null` when the runtime cannot delete an owner; `forget` then only unsubscribes and hides the rows (`deleted: false`).

## In-memory

`makeInMemoryShardDb<Schema>(tableColumns)`: non-durable, single-process, synchronous. It keys rows by `(ownerId, id)` like Evolu, so an update aimed at the wrong owner creates a phantom row, the trap copy-on-write exists to avoid. `tableColumns` lists each table's columns so a never-written column reads back as `null`; for the Linky schema pass `linkyTableColumns`. It implements `deleteOwner` and exposes `usedOwners()` for asserting the subscribe set after `reconcileSync()`.

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

`createEvoluShardDb(evolu)` from `@linky-fit/linksync/evolu` takes an `EvoluRuntime`: structurally, an Evolu instance whose schema contains `LinkySchema` (a superset is fine). Each row is validated before it is queued, so one rejected row fails as `ShardDbError` instead of failing Evolu's whole mutation batch. `ownerUsage` is measured over `evolu_history`. `deleteOwner` is `null`: a forgotten shard keeps its local bytes and relay history until Evolu can delete an owner.
