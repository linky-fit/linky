# Ports

How the store talks to storage, and what a new runtime must implement.

## `ShardDb`

`src/core/ShardDb.ts` mirrors what Evolu offers and nothing more; every shard rule lives in the store.

| Method                       | Contract                                                                                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `readTable(table)`           | Every row of the table across all owners, tombstones included; reflects earlier `mutate` calls immediately.                                                   |
| `mutate(mutations)`          | Column-level writes keyed by `(ownerId, id)`. `upsert` carries a full row, `update` a patch that may set `isDeleted`; an unknown key on update creates a row. |
| `subscribe(table, listener)` | Fires after any change to the table, local or synced.                                                                                                         |
| `useOwner(owner)`            | Opts the owner into sync; returns the unuse function.                                                                                                         |
| `ownerUsage(ownerId)`        | `{ mutations, bytes }` of the owner's history; the rotation rule reads it.                                                                                    |
| `deleteOwner`                | `null` when the runtime cannot delete an owner (Evolu 7); otherwise drops the owner's data.                                                                   |

Rows come back as `Row<Columns>`: the table's columns, every non-id one nullable, plus `ownerId`, `createdAt`, `updatedAt` (ISO strings) and `isDeleted` (`0 | 1 | null`).

**Read-after-write.** The store chains a write and a read inside one operation (copy-on-write reads the current row, the wallet reads the inventory it just changed) and holds no cache, so `readTable` must return what `mutate` was given even when the database commits later.

## In-memory

`makeInMemoryShardDb<Schema>(tableColumns)` (`src/core/inMemoryShardDb.ts`): non-durable, single-process, synchronous. It keys rows by `(ownerId, id)` like Evolu, so an update aimed at the wrong owner creates a phantom row, the trap copy-on-write exists to avoid. `tableColumns` lists each table's columns so a never-written column reads back as `null`; for the Linky schema pass `linkyTableColumns`. It exposes `usedOwners()` for asserting the subscribe set and implements `deleteOwner`.

## Evolu 7

`createEvoluShardDb(evolu)` from `@linky-fit/linksync/evolu` (`src/evolu/evoluShardDb.ts`) takes an `EvoluRuntime`: structurally, an Evolu instance whose schema contains `LinkySchema` (a superset is fine). It is the one file that touches the Evolu runtime; the reasoning behind each point is a comment there.

- Reads: one cached `createQuery`/`loadQuery` per table, merged with an overlay of the adapter's own writes until the loaded rows reflect them. A never-updated row reports `createdAt` as its `updatedAt`.
- Writes: `upsert` and `update` with `{ ownerId }`; each row is validated (`onlyValidate`) before it is queued, so one rejected row becomes `ShardDbError` instead of failing Evolu's whole batch.
- `subscribe`: `subscribeQuery` on the table's query.
- `ownerUsage`: distinct timestamps and summed value length over `evolu_history` for the owner's id bytes.
- `deleteOwner`: `null`.
