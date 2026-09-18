# Core

The generic shard store: no Linky in it. Use it directly only when adding a scope or a port; the repositories are its everyday surface.

## Scopes

A scope is one kind of data with one storage policy (`src/core/scope.ts`):

```ts
import { appScope, shardScope } from "@linky/linksync";

const scopes = {
  meta: appScope(["shardPointer", "setting"]),
  notes: shardScope({
    tables: ["note"],
    rotation: { maxBytes: 256 * 1024, maxMutations: 220, cooldownMs: 60_000 },
    forget: "never",
  }),
  chats: shardScope({
    tables: ["chat"],
    rotation: null, // pinned to shard 0
    forget: { keepNewest: 2 },
  }),
};
```

An `appScope` lives in the Evolu `AppOwner`, one fixed partition. A `shardScope` lives in `ShardOwner`s derived as `deriveShardOwner(appOwner, [scope, index])`; `rotation: null` pins it to index 0. `visibleIndexes(scope, active)` and `forgottenIndexes(scope, active)` are the two pure functions the policy reduces to.

## The store

```ts
import { createShardStore, makeInMemoryShardDb } from "@linky/linksync";

const db = makeInMemoryShardDb<Schema>(tableColumns);
const store = createShardStore<Schema, typeof scopes>({ db, appOwner, scopes });
```

`Schema` maps table name to column types and must include `shardPointer` (`CoreSchema`). Pass the two type arguments explicitly; they cannot be inferred from the port.

| Method                            | Contract                                                                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `rows(scope, table)`              | Live rows across the visible shards, one per id, the highest shard's copy.                                                      |
| `insert(scope, table, row)`       | Writes into the active shard. `row` needs every non-nullable column; nullable ones may be omitted.                              |
| `update(scope, table, id, patch)` | Copy-on-write; fails with `RowNotFound` for an id no visible shard holds.                                                       |
| `remove(scope, table, id)`        | Tombstones the row where it lives.                                                                                              |
| `ingest(scope, table, rows)`      | Copies foreign rows into the active shard, idempotently; returns how many it wrote.                                             |
| `foreignRows(table, ownerId)`     | The rows of one owner, for feeding `ingest`.                                                                                    |
| `activeIndex(scope)`              | The pointer's index, or a locally written rotation the read model has not shown yet.                                            |
| `visibleShards(scope)`            | `{ index, owner }` for every shard a device reads and syncs.                                                                    |
| `rotate(scope)`                   | Moves the pointer unconditionally; returns the new index.                                                                       |
| `maybeRotate(scope)`              | Rotates when usage crosses `maxBytes` or `maxMutations` and the cooldown passed; returns why it did not otherwise.              |
| `syncOwners()`                    | The app owner plus every visible shard of every scope.                                                                          |
| `reconcileSync()`                 | Calls `useOwner` for owners entering the set and the unuse function for owners leaving it. Call after boot and after rotations. |
| `forget()`                        | Shards outside a forgettable scope's window: unsubscribed, and deleted when the port can.                                       |
| `subscribe(scope, listener)`      | Fires after any change to the scope's tables.                                                                                   |

Every method returns an `Effect`; errors are `ShardDbError` (the port rejected a write), `RowNotFound`, and `UnknownScope`. Time comes from Effect's `Clock`, so tests drive the cooldown with a manual clock.

## Rotation in detail

`maybeRotate` reads `ownerUsage(activeShard)` from the port: mutations and value bytes of that owner's whole history (a fresh shard starts at zero, so no baseline is needed). It rotates when either number reaches the rule and no rotation of the scope happened within `cooldownMs`, judged by the pointer's `rotatedAtMs` and the store's own last rotation. Rotation writes the pointer into the app owner and immediately reconciles sync so the new shard uploads.

Call `maybeRotate` after writes, the way the app's rotation hook did; the store does not schedule it.

## Ids

`shardPointerId(scope)` is deterministic so every device upserts one pointer row. Row ids are the caller's; `createId<"Table">()` from the model makes random ones.

## Owners

`appOwnerFromMnemonic(text)` turns a BIP-39 mnemonic into the Evolu `AppOwner` it names, or `null` when the text is not a mnemonic. The app uses it for its own owner and the lane migration for the legacy owners, so no app file needs Evolu's owner functions.
