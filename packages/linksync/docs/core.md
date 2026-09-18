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

| Method                            | Contract                                                                                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rows(scope, table)`              | Live rows across the visible shards, one per id, the highest shard's copy.                                                                        |
| `copies(scope, table)`            | Every copy in the visible shards, tombstones and duplicate ids included, highest shard first; for a domain rule that beats the merge.             |
| `insert(scope, table, row)`       | Writes into the active shard. `row` needs every non-nullable column; nullable ones may be omitted.                                                |
| `update(scope, table, id, patch)` | Copy-on-write; fails with `RowNotFound` for an id no visible shard holds.                                                                         |
| `remove(scope, table, id)`        | Tombstones the row where it lives.                                                                                                                |
| `ingest(scope, table, rows)`      | Copies foreign rows into the active shard, idempotently; returns how many it wrote.                                                               |
| `foreignRows(table, ownerId)`     | The rows of one owner, for feeding `ingest`.                                                                                                      |
| `activeIndex(scope)`              | The pointer's index, or a locally written rotation the read model has not shown yet.                                                              |
| `visibleShards(scope)`            | `{ index, owner }` for every shard a device reads and syncs.                                                                                      |
| `rotate(scope)`                   | Moves the pointer unconditionally; returns the new index.                                                                                         |
| `maybeRotate(scope)`              | Rotates when usage crosses `maxBytes` or `maxMutations` and the cooldown passed; returns why it did not otherwise.                                |
| `syncOwners()`                    | The app owner plus every visible shard of every scope.                                                                                            |
| `reconcileSync()`                 | Calls `useOwner` for owners entering the set and the unuse function for owners leaving it. Call after boot and after rotations.                   |
| `retainVisibleShards()`           | Retains the current windows after the caller's initial pointer hydration gate settles; existing local rows and writes retain immediately.         |
| `forget(scope?)`                  | Explicitly forgets one scope, or all forgettable scopes if omitted; notifies readers, unsubscribes old shards and deletes only when the port can. |
| `subscribe(scope, listener)`      | Fires after a scope table or pointer changes, or after explicit forgetting.                                                                       |
| `subscribePointers(listener)`     | Fires after a pointer change, local or synced, or explicit forgetting.                                                                            |
| `followPointers(onRotated)`       | Reconciles sync whenever a pointer moves (a rotation here or on another device) and reports the scope and new index.                              |

Every method returns an `Effect`; errors are `ShardDbError` (the port rejected a write), `RowNotFound`, and `UnknownScope`. Time comes from Effect's `Clock`, so tests drive the cooldown with a manual clock.

## Rotation in detail

`maybeRotate` reads `ownerUsage(activeShard)` from the port: mutations and value bytes of that owner's whole history (a fresh shard starts at zero, so no baseline is needed). It rotates when either number reaches the rule and no rotation of the scope happened within `cooldownMs`, judged by the pointer's `rotatedAtMs` and the store's own last rotation. Rotation writes the pointer into the app owner and immediately reconciles sync so the new shard uploads.

The store does not schedule `maybeRotate`; every `TableRepository` write (`insert`, `update`, `remove`) calls it after the mutation, so a repository user never rotates by hand, and a batch writer (the wallet's `proofs.insert`) runs the repository's `maybeRotate` once after its raw store writes. Concurrent writes each run the check, but only the first one whose check passes rotates; the others report `cooldown` while that rotation is in flight. A pointer write the port rejects does not fail the row write: the repository logs it (`Effect.logWarning`) and the next write repeats the check, because a consumer that chains writes (linkshu stores a send's outputs, then marks its inputs spent) must not die halfway over bookkeeping.

A rotation on another device reaches this one as a pointer change. `followPointers` is the one subscription an app keeps for the store's lifetime: it reconciles the sync set on every change so the new shard uploads and downloads, and reports each `{ scope, index }` that moved (local rotations included) so the app can log it.

## Ids

`shardPointerId(scope)` is deterministic so every device upserts one pointer row. Row ids are the caller's; `createId<"Table">()` from the model makes random ones and `createIdFromString<"Table">(text)` (re-exported from Evolu) derives one from text.

## Owners

`appOwnerFromMnemonic(text)` turns a BIP-39 mnemonic into the Evolu `AppOwner` it names, or `null` when the text is not a mnemonic. The app uses it for its own owner and the lane migration for the legacy owners, so no app file needs Evolu's owner functions. The owner types the store speaks (`AppOwner`, `SyncOwner`, `OwnerId`) are re-exported for the same reason.

## Device-local retention

`createShardStore` accepts optional `retention: ShardRetention`, with synchronous `get(scope): number | undefined` and `set(scope, firstIndex): void`. The caller namespaces this durable state by app owner and device. The store owns index decisions; the port only persists them. Never sync it. `createLinkyStore(db, appOwner, { retention, scopes? })` forwards it; `scopes` defaults to `linkyScopes` and allows isolated test rotation rules without mutating the shared registry.

On first read the store restores a saved first index or discovers locally present shard rows. It retains subsequent windows and local writes until `forget`. An empty device's provisional index 0 is not remembered before a pointer or local write establishes it. Forgetting changes both reads and subscriptions immediately, including React readers via scope and pointer listeners; reloading does not expose the cached forgotten rows again when a durable retention port is provided.

Initial pointer hydration can expose intermediate indexes. The store does not retain these provisional windows. After the caller's bootstrap gate settles, call `retainVisibleShards()` once to retain the current windows through later remote rotations. Existing local rows and local writes are retained immediately. Linky reuses its Evolu/Nostr bootstrap gate, which waits for quiet reads with an 8 s fallback because Evolu 7 has no initial-sync-complete signal. A severely delayed initial sync can outlast that heuristic; it is not a protocol acknowledgment.
