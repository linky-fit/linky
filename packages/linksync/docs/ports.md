# Ports

How the store talks to storage, and how to implement it for a new runtime.

## `ShardDb`

`src/core/ShardDb.ts`. The port mirrors what Evolu offers and nothing more; every shard rule lives in the store.

| Method                       | Contract                                                                                                                                                                            |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `readTable(table)`           | Every row of the table across all owners, tombstones included. Must reflect earlier `mutate` calls immediately (see below).                                                         |
| `mutate(mutations)`          | Column-level writes keyed by `(ownerId, id)`. `upsert` carries a full row, `update` a patch that may set `isDeleted`. Unknown `(ownerId, id)` on update creates a row, as in Evolu. |
| `subscribe(table, listener)` | Fires after any change to the table, local or synced.                                                                                                                               |
| `useOwner(owner)`            | Opts the owner into sync; returns the unuse function.                                                                                                                               |
| `ownerUsage(ownerId)`        | `{ mutations, bytes }` of the owner's history; the rotation rule reads it.                                                                                                          |
| `deleteOwner`                | `null` when the runtime cannot delete an owner (Evolu 7); otherwise drops the owner's data.                                                                                         |

Rows come back as `Row<Columns>`: the table's columns, every non-id one nullable, plus `ownerId`, `createdAt`, `updatedAt` (ISO strings), and `isDeleted` (`0 | 1 | null`).

**Read-after-write.** The store chains a write and a read inside one operation (copy-on-write reads the current row, the wallet reads the inventory it just changed), so `readTable` must return what `mutate` was given even when the database commits later. The in-memory port is synchronous; the Evolu adapter keeps an overlay of its own writes and serves each entry until the loaded row reflects it.

## In-memory

`makeInMemoryShardDb<Schema>(tableColumns)` (`src/core/inMemoryShardDb.ts`). Non-durable, single-process. It keys rows by `(ownerId, id)` like Evolu, so an update aimed at the wrong owner creates a phantom row, which is exactly the trap the store's copy-on-write exists to avoid. `tableColumns` lists each table's columns so a column never written reads back as `null`; for the Linky schema pass `linkyTableColumns`. It also exposes `usedOwners()` for asserting the subscribe set and implements `deleteOwner`.

## Evolu 7

`createEvoluShardDb(evolu)` from `@linky/linksync/evolu` (`src/evolu/evoluShardDb.ts`) takes an `EvoluRuntime`: structurally, an Evolu instance whose schema contains `LinkySchema` (the type names only `useOwner`; the query and mutation methods are reached through untyped calls). The app passes its instance, whose schema is a superset while the legacy tables are still around. It is the one file that touches the Evolu runtime:

- Reads: `createQuery(db => db.selectFrom(table).selectAll())` and `loadQuery`, cached per table, merged with the write overlay. Evolu stamps `createdAt` on insert and upsert and `updatedAt` only on update, so a never-updated row comes back with a null `updatedAt`; the adapter reports `createdAt` there, keeping the port's promise that `updatedAt` is the row's last change time.
- Writes: `upsert` and `update` with `{ ownerId }`. The port's boolean `isDeleted` becomes Evolu's `SqliteBoolean` on the way in (a tombstone written as `true` fails Evolu's validation, and the copy-forward that tombstones an old copy is the first write that ever does). Every row is validated first (`onlyValidate`) and a rejected row becomes `ShardDbError` before anything is queued, because Evolu runs all mutations queued in one microtask as a single transaction and drops the whole batch, unrelated app writes included, when any of them fails validation.
- `subscribe`: `subscribeQuery` on the table's query.
- `ownerUsage`: `count(distinct timestamp)` and `sum(length(value))` over `evolu_history` for the owner. The history table keys rows by the owner id's bytes (`ownerIdToOwnerIdBytes`), not its base64url text; comparing the text reads zero and no shard ever rotates on its own.
- `deleteOwner`: `null`; Evolu 7 has no owner deletion.

Evolu's query builder and mutation types are per-table generics while the port is table-dynamic, so those calls go through untyped references with the table name checked against the schema and every row and result validated, the same pattern the app's `evolu.ts` uses for `evolu_history`.
