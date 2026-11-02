# Ports

How to implement the platform ports so linkshu can run on your storage.

## Overview

A port is an Effect `Context.Service`; you satisfy it with a `Layer` that builds the service object. Ports are dumb on purpose: they persist what they are given and decide nothing.

| Port             | Layer                              | In-memory default        |
| ---------------- | ---------------------------------- | ------------------------ |
| `KeyValueStore`  | `Layer.sync(KeyValueStore, make)`  | `inMemoryKeyValueStore`  |
| `ProofStore`     | `Layer.sync(ProofStore, make)`     | `inMemoryProofStore`     |
| `OperationStore` | `Layer.sync(OperationStore, make)` | `inMemoryOperationStore` |
| `CashuSeed`      | `CashuSeed.fromBytes(bip39Seed)`   | none (always yours)      |

`linkshuServices(config)` and `runLinkshu(config, ...)` build `CashuSeed` from `config.bip39Seed` and fall back to the in-memory stores when you omit the others.

What lives where: the `ProofStore` and `OperationStore` are the wallet; sync them between devices if you have sync. The `KeyValueStore` holds only device-local state (deterministic counters and their leases, the lease over each mint's receives and over each envelope, restore cursors, seen mints and keysets, the fee-probe cache). Sharing it between devices is not required, but every context on one device that uses the seed must share it (see the lease below). Keys are namespaced with a `linkshu.` prefix and values never contain seed material.

Every port method returns an `Effect` that must not fail; throw only for genuine storage corruption.

## `KeyValueStore`

Durable string storage plus three lease primitives. `listKeys(prefix)` drives the seed-bound wipe and the known-mint set, so if your storage is shared with other data, namespace it on your side and let `listKeys` see only this store's own entries.

| Port guarantees                                                 | Package handles                                                             |
| --------------------------------------------------------------- | --------------------------------------------------------------------------- |
| One `tryAcquireLease` wins when several race the same key       | Retrying acquisition, timing out, mapping a timeout to `CounterLockTimeout` |
| A lease is claimable once its TTL passes without a `renewLease` | Renewing a held lease every third of its TTL until it releases it           |
| A foreign `LeaseId` cannot renew or release a lease             | Choosing TTLs, which keys to lock, releasing on exit/interrupt              |
| Values survive a restart (unless you are the in-memory default) | Key naming and value encoding                                               |

The atomic claim is the hard part. With a locked read-modify-write over your state (here `modify(change)` gives `change` the freshest state and applies its `[nextState, result]` with no other writer in between), the lease primitives are:

```ts
tryAcquireLease: (key, ttlMs) =>
  Effect.flatMap(Clock.currentTimeMillis, (now) =>
    modify((state) => {
      const held = state.leases[key];
      if (held !== undefined && held.expiresAt > now) return [state, null];
      const lease = LeaseId.make(crypto.randomUUID());
      return [
        { ...state, leases: { ...state.leases, [key]: { lease, expiresAt: now + ttlMs } } },
        lease,
      ];
    }),
  ),

renewLease: (key, lease, ttlMs) =>
  Effect.flatMap(Clock.currentTimeMillis, (now) =>
    modify((state) =>
      state.leases[key]?.lease === lease
        ? [{ ...state, leases: { ...state.leases, [key]: { lease, expiresAt: now + ttlMs } } }, undefined]
        : [state, undefined],
    ),
  ),

releaseLease: (key, lease) =>
  modify((state) =>
    state.leases[key]?.lease === lease
      ? [{ ...state, leases: without(state.leases, key) }, undefined]
      : [state, undefined],
  ),
```

Read the clock through Effect's `Clock`, not `Date.now()`, so tests can drive time. The package renews a lease for as long as its holder works, however long a mint takes to answer, so the TTL only bounds how long a holder that died (a killed process) keeps the key.

In a browser, `localStorage` has neither a compare-and-swap nor a locked read-modify-write: another tab can read a key before your write reaches it, so writing a lease record and re-reading it lets two tabs both win. Hold each lease as a Web Lock instead: `navigator.locks.request(name, { ifAvailable: true }, callback)` grants it to one context of the origin, a `null` lock means it is held, and the callback's promise keeps it until `releaseLease` settles it. A closed tab frees its locks, so a Web Lock lease can ignore the TTL and make `renewLease` a no-op. Resolve `releaseLease` only once the lock request settles, so the next claim sees the lease free.

## `ProofStore`

The inventory. Spent proofs are never deleted, so the store grows with the wallet's history while the proofs that can still move stay few. The package reads only what a decision needs:

| Read                             | Returns                                                                                     | Used for                                                                   |
| -------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `loadUnspent`                    | every proof whose state is not `spent`                                                      | spending, balances, validation, resuming melts; before every decision      |
| `findBySecrets(secrets)`         | the proofs with these secrets, any state                                                    | dedup when receiving, restoring, importing or reclaiming change            |
| `findByOperation(operationId)`   | the proofs whose `operationId` is the operation, any state                                  | a melt's inputs, a reclaimed send, one transfer's proofs                   |
| `findOldestByKeysets(keysetIds)` | per keyset id, its proof with the lowest `createdAt` (ties to the lowest `mint`), any state | binding a keyset to its mint on every wallet load ([mints.md](./mints.md)) |

`loadUnspent` runs before every operation, so its cost must follow the working set, not the history: filter by state in the store (an index on it) instead of loading every row and filtering in memory. A store small enough to load whole for every read, such as a file, can build the four reads with `proofReadsOf(loadAll)`.

Every proof write is one `write({ insert, update })` call: the inserts, then the patches (`{ id, patch }`), in order, so a patch may target a proof inserted earlier in the same batch. The package books everything one step decides in one batch; a send's handed-out proofs, its change and its spent inputs are a single call. A batch must land all-or-nothing: a crash or error leaves either every row of it or none. Make it one transaction of your database, not one per row. `write` returns the inserted proofs, in input order, with their ids and `createdAt`; an update of an unknown id is a no-op. The package holds no cache, so every read must reflect your own earlier writes immediately, even when the underlying database commits asynchronously (keep a write overlay if it does).

Why ids derive from the secret: two devices that both come to hold one proof (a synced balance, a restore on each) must converge on one row, or the balance doubles. `deriveStoreId(secret)` is the package's hash for stores without an id scheme of their own; neither it nor your own scheme may reveal the secret. Inserting a secret that is already stored is an upsert onto that row, keeping its `createdAt`.

The platform never decides states. Do not default, normalize, or "fix" a state on write, and never delete a proof; `spent` is kept on purpose: dedup and the keyset binding read it. Skip a stored row that does not validate as `StoredProof` in every read instead of repairing it. `StoredProof.secret` and `dleq` are spendable material; keep them out of logs.

`applyProofWrite(rows, batch, now)` applies a batch to a `Map` of rows by id and returns the inserted proofs, so an adapter that keeps its rows in memory or in one file implements `write` as load, apply, save.

## `OperationStore`

The same shape for operations, read whole through `loadAll`, with the same read-after-write requirement.

`operationKeyOf` is the natural key: a quote operation is `kind|mint|quoteId`, even a `melt` that carries its envelope's token text; any other operation with token text (a transfer, a `deferredReceive` or an `envelope`) is `kind|tokenText`. Hash it with `deriveStoreId` (or your own scheme); the key contains token text, so it must not become the id as is. Inserting an existing key replaces every field of that row. Inputs are never stored on the operation: they are the proofs whose `operationId` points at it. `StoredOperation.tokenText` carries proof secrets.

`applyOperationPatch` is exported for `update`.

## `CashuSeed`

```ts
import { Bip39Seed, CashuSeed } from "@linky-fit/linkshu";

const seedLayer = (seedBytes: Uint8Array) =>
  CashuSeed.fromBytes(Bip39Seed.make(seedBytes));
```

You only build this yourself when assembling layers by hand; `linkshuServices` does it from `config.bip39Seed`. The package is the trust boundary the seed exists for; never derive keys or counters on the platform side.

## In-memory defaults and durability across runtimes

`inMemoryKeyValueStore`, `inMemoryProofStore`, and `inMemoryOperationStore` are `Layer.sync`, so every runtime built from them gets a fresh, empty store. The instance `makeInMemoryProofStore()` returns also has `all`, every proof in any state, for inspection. To model a restart (two runtimes over one storage) create the instances once and wrap them with `Layer.succeed`:

```ts
import {
  KeyValueStore,
  makeInMemoryKeyValueStore,
  makeInMemoryOperationStore,
  makeInMemoryProofStore,
  OperationStore,
  ProofStore,
} from "@linky-fit/linkshu";
import { Layer } from "effect";

const kv = makeInMemoryKeyValueStore();
const proofs = makeInMemoryProofStore();
const operations = makeInMemoryOperationStore();
const layers = {
  keyValueStore: Layer.succeed(KeyValueStore, kv),
  proofStore: Layer.succeed(ProofStore, proofs),
  operationStore: Layer.succeed(OperationStore, operations),
};
```

## Related

- [concepts.md](./concepts.md): proof states, operation statuses, and the counter lease
- [testing.md](./testing.md): what an adapter test should cover
