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

`createEvoluShardDb(evolu)` from `@linky/linksync/evolu` (`src/evolu/evoluShardDb.ts`) takes an `Evolu<typeof LinkySchema>` instance. It is the one file that touches the Evolu runtime:

- Reads: `createQuery(db => db.selectFrom(table).selectAll())` and `loadQuery`, cached per table, merged with the write overlay.
- Writes: `upsert` and `update` with `{ ownerId }`; a rejected mutation becomes `ShardDbError`.
- `subscribe`: `subscribeQuery` on the table's query.
- `ownerUsage`: `count(distinct timestamp)` and `sum(length(value))` over `evolu_history` for the owner.
- `deleteOwner`: `null`; Evolu 7 has no owner deletion.

Evolu's query builder and mutation types are per-table generics while the port is table-dynamic, so those calls go through untyped references with the table name checked against the schema and every row and result validated, the same pattern the app's `evolu.ts` uses for `evolu_history`.
