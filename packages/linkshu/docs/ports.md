# Ports

How to implement the platform ports so linkshu can run on your storage. You need this when bringing the package to a new platform, or when changing the web app's Evolu/localStorage adapters.

## Overview

A port is an Effect `Context.Tag`; you satisfy it with a `Layer` that builds the service object. Ports are deliberately dumb: they persist what they are given and decide nothing.

| Port             | Tag                      | Layer helper                       | In-memory default        |
| ---------------- | ------------------------ | ---------------------------------- | ------------------------ |
| `KeyValueStore`  | `linkshu/KeyValueStore`  | `Layer.sync(KeyValueStore, make)`  | `inMemoryKeyValueStore`  |
| `ProofStore`     | `linkshu/ProofStore`     | `Layer.sync(ProofStore, make)`     | `inMemoryProofStore`     |
| `OperationStore` | `linkshu/OperationStore` | `Layer.sync(OperationStore, make)` | `inMemoryOperationStore` |
| `CashuSeed`      | `linkshu/CashuSeed`      | `CashuSeed.fromBytes(bip39Seed)`   | none (always yours)      |

`linkshuServices(config)` and `runLinkshu(config, …)` build `CashuSeed` from `config.bip39Seed` and fall back to the in-memory stores when you omit `keyValueStore`/`proofStore`/`operationStore`.

What lives where: the `ProofStore` and `OperationStore` are the wallet — sync them between devices if you have sync. The `KeyValueStore` holds only device-local state (deterministic counters and their leases, restore cursors, seen mints and keysets, the fee-probe cache); sharing one between devices is not required, but every context on one device that uses the seed must share it (see the lease below).

Complete, short implementations to copy from:

- `apps/linkshu-cli/src/fileKeyValueStore.ts`, `fileProofStore.ts`, and `fileOperationStore.ts` — one JSON file each, safe across processes.
- `apps/web-app/src/platform/linkshu/localStorageKeyValueStore.ts`, `evoluProofStore.ts`, and `evoluOperationStore.ts` — the browser adapters; `evoluWriteOverlay.ts` is the read-after-write bridge both Evolu adapters share.
- `apps/site/src/cashu/walletStorage.ts` — all three stores over `localStorage`, for the public site's redemption page.

## `KeyValueStore`

Durable string storage plus two lease primitives. Every method returns an `Effect` that must not fail (`Effect.Effect<…>` with `never` error); throw only for genuine storage corruption.

| Method                        | Contract                                                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `get(key)`                    | Stored value or `null`.                                                                                                         |
| `set(key, value)`             | Durable write.                                                                                                                  |
| `remove(key)`                 | Delete; no-op if absent.                                                                                                        |
| `listKeys(prefix)`            | All stored keys starting with `prefix`. Drives seed-bound wipes, the known-mint set, and the one-time legacy record carry-over. |
| `tryAcquireLease(key, ttlMs)` | Atomically claim `key` for `ttlMs`; return a fresh `LeaseId`, or `null` if a live lease is held. Expired leases are claimable.  |
| `releaseLease(key, lease)`    | Delete the lease only if `lease` is still the live one; otherwise no-op.                                                        |

What the port must guarantee versus what the package handles:

| Port guarantees                                                 | Package handles                                                |
| --------------------------------------------------------------- | -------------------------------------------------------------- |
| One `tryAcquireLease` wins when several race the same key       | Retrying acquisition and timing out                            |
| A lease past its TTL is claimable                               | Choosing TTLs, which keys to lock, releasing on exit/interrupt |
| A foreign `LeaseId` cannot release a lease                      | Mapping a timeout to `CounterLockTimeout`                      |
| Values survive a restart (unless you are the in-memory default) | Key naming (`linkshu.` prefix) and value encoding              |

Values never contain seed material. If your storage is shared with other data, namespace it on your side; `listKeys` must then only see this store's own entries.

The atomic claim is the hard part. The CLI's `fileKeyValueStore.ts` keeps values and leases in one JSON file behind `makeJsonFile` (`apps/linkshu-cli/src/jsonFile.ts`), whose `file.modify(change)` is a locked read-modify-write: `change` gets the freshest contents and returns `[nextContents, result]`, and no other writer runs in between. `without(record, key)` is a local helper that drops one key. With those two, the lease primitives are:

```ts
tryAcquireLease: (key, ttlMs) =>
  Effect.flatMap(Clock.currentTimeMillis, (now) =>
    file.modify((state) => {
      const held = state.leases[key];
      if (held !== undefined && held.expiresAt > now) return [state, null];
      const lease = LeaseId.make(crypto.randomUUID());
      return [
        { ...state, leases: { ...state.leases, [key]: { lease, expiresAt: now + ttlMs } } },
        lease,
      ];
    }),
  ),

releaseLease: (key, lease) =>
  file.modify((state) =>
    state.leases[key]?.lease === lease
      ? [{ ...state, leases: without(state.leases, key) }, undefined]
      : [state, undefined],
  ),
```

Read the clock through Effect's `Clock`, not `Date.now()`, so tests can drive time. When your storage has no compare-and-swap (localStorage), write then re-read and confirm your id won — see `localStorageKeyValueStore.ts`.

Wiring a layer from your service object (skeleton, not compilable as-is: `makeMyKeyValueStore` must return all six methods):

```ts
import { KeyValueStore } from "@linky/linkshu";
import type { KeyValueStoreService } from "@linky/linkshu";
import { Layer } from "effect";

declare const makeMyKeyValueStore: () => KeyValueStoreService;

export const myKeyValueStore: Layer.Layer<KeyValueStore> = Layer.sync(
  KeyValueStore,
  makeMyKeyValueStore,
);
```

## `ProofStore`

The inventory. The package holds no cache: it calls `loadAll` before every decision, so `loadAll` must reflect your own earlier `insert`/`update` calls immediately, even when the underlying database commits asynchronously (the web app's Evolu adapters keep a write overlay for exactly this reason).

| Method               | Contract                                                                                                                                                                                                                    |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `insert(NewProof[])` | Assign each `id` and `createdAt`, persist, return the `StoredProof`s in order. The id **must** be a pure function of `secret`; inserting a secret that is already stored is an upsert onto that row (its `createdAt` kept). |
| `update(id, patch)`  | Apply only the present fields of `ProofPatch` (`state`, `operationId`). Unknown id: no-op.                                                                                                                                  |
| `loadAll`            | Every stored proof, any state. An `Effect` value, not a function.                                                                                                                                                           |

`StoredProof` (`src/ports/ProofStore.ts`):

| Field         | Type                           | Notes                                                                   |
| ------------- | ------------------------------ | ----------------------------------------------------------------------- |
| `id`          | `ProofId`                      | Derived from `secret`; the package refers to proofs by it               |
| `mint`        | `MintUrl`                      |                                                                         |
| `unit`        | `CurrencyUnit`                 |                                                                         |
| `keysetId`    | `KeysetId`                     |                                                                         |
| `amount`      | `Amount`                       |                                                                         |
| `secret`      | `Schema.NonEmptyString`        | The spendable secret; keep it out of logs                               |
| `C`           | hex string                     | NUT-00 signature point                                                  |
| `dleq`        | `Schema.NullOr(Schema.String)` | JSON of the NUT-12 DLEQ proof when the mint supplied one                |
| `state`       | `ProofState`                   | Written only by the package ([concepts.md](./concepts.md#proof-states)) |
| `operationId` | `Schema.NullOr(OperationId)`   | The operation holding the proof; null for balance                       |
| `createdAt`   | `UnixSeconds`                  | Assigned on insert                                                      |

`NewProof` is the same without `id` and `createdAt`.

**Why ids derive from the secret.** Two devices that both come to hold one proof — a synced balance, a restore on each, a legacy ingest on each — must converge on one row, or the balance doubles. `deriveStoreId(secret)` is the package's hash for stores without an id scheme of their own (the CLI, the site); the web app uses Evolu's `createIdFromString(secret)`. Neither id reveals the secret.

**The platform never decides states.** Do not default, normalize, or "fix" a state on write, and never delete a proof — `spent` is kept on purpose. A stored row that does not validate as `StoredProof` is skipped in `loadAll`, not repaired.

The CLI's `fileProofStore.ts` is the shortest real one: a JSON array of `StoredProof`, written through the same `file.modify` as above. `applyProofPatch` is exported so an adapter does not reimplement the patch:

```ts
insert: (proofs) =>
  Effect.flatMap(Clock.currentTimeMillis, (millis) =>
    file.modify((rows) => {
      const byId = new Map(rows.map((row) => [row.id, row]));
      const stored = proofs.map((proof) => {
        const id = ProofId.make(deriveStoreId(proof.secret));
        const row = new StoredProof({
          ...proof,
          id,
          createdAt:
            byId.get(id)?.createdAt ??
            UnixSeconds.make(Math.floor(millis / 1000)),
        });
        byId.set(id, row);
        return row;
      });
      return [[...byId.values()], stored];
    }),
  ),

update: (id, patch) =>
  file.modify((rows) => [
    rows.map((row) => (row.id === id ? applyProofPatch(row, patch) : row)),
    undefined,
  ]),
```

## `OperationStore`

The same shape for operations. `loadAll` has the same read-after-write requirement.

| Method                 | Contract                                                                                                                                                                                                   |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `insert(NewOperation)` | Assign the `id`, persist, return the `StoredOperation`. The id **must** be a pure function of `operationKeyOf(operation)`; inserting an existing key is an upsert onto that row with every field replaced. |
| `update(id, patch)`    | Apply only the present fields of `OperationPatch` (`status`, `counter`, `error`). Unknown id: no-op.                                                                                                       |
| `loadAll`              | Every stored operation, any status.                                                                                                                                                                        |

`operationKeyOf` is the natural key: a transfer is `kind|tokenText`, a quote operation is `kind|mint|quoteId`. Hash it with `deriveStoreId` (or your own id scheme) — the key contains token text, so it must not become the id as-is.

`StoredOperation` (`src/ports/OperationStore.ts`):

| Field         | Type                               | Notes                                                                                   |
| ------------- | ---------------------------------- | --------------------------------------------------------------------------------------- |
| `id`          | `OperationId`                      | Derived from `operationKeyOf`                                                           |
| `kind`        | `OperationKind`                    | `melt`, `topup`, `autoswap`, `send`, `receive`                                          |
| `status`      | `OperationStatus`                  | Written only by the package ([concepts.md](./concepts.md#operation-kinds-and-statuses)) |
| `mint`        | `MintUrl`                          | The target mint for `autoswap`                                                          |
| `unit`        | `CurrencyUnit`                     |                                                                                         |
| `keysetId`    | `Schema.NullOr(KeysetId)`          | Quote kinds: keyset the deterministic outputs derive from                               |
| `amount`      | `Amount`                           |                                                                                         |
| `feeReserve`  | `Schema.NullOr(NonNegativeAmount)` | `melt` only                                                                             |
| `inputsTotal` | `Schema.NullOr(Amount)`            | `melt` only: sum of the held inputs                                                     |
| `quoteId`     | `Schema.NullOr(QuoteId)`           | Quote kinds                                                                             |
| `invoice`     | `Schema.NullOr(Bolt11Invoice)`     | Quote kinds                                                                             |
| `sourceMint`  | `Schema.NullOr(MintUrl)`           | `autoswap` only                                                                         |
| `counter`     | `Schema.NullOr(non-negative int)`  | Quote kinds: first output slot of the latest attempt; synced so any device can resume   |
| `locked`      | `Schema.NullOr(Schema.Boolean)`    | `topup`: NUT-20 locked quote                                                            |
| `expiresAt`   | `Schema.NullOr(UnixSeconds)`       | Mint-stated quote expiry                                                                |
| `createdAt`   | `UnixSeconds`                      | Event time, set by the package on insert                                                |
| `tokenText`   | `Schema.NullOr(TokenText)`         | Transfer kinds; carries proof secrets, keep it out of logs                              |
| `error`       | `Schema.NullOr(Schema.String)`     | Serialized tagged error of the last failure                                             |

`NewOperation` is the same without `id`. Inputs are never stored on the operation: they are the proofs whose `operationId` points at it.

The CLI's `fileOperationStore.ts`, again over `file.modify`, with the exported `applyOperationPatch` for `update`:

```ts
insert: (operation) =>
  file.modify((rows) => {
    const id = OperationId.make(deriveStoreId(operationKeyOf(operation)));
    const stored = new StoredOperation({ ...operation, id });
    return [[...rows.filter((row) => row.id !== id), stored], stored];
  }),
```

## `CashuSeed`

```ts
import { Bip39Seed, CashuSeed } from "@linky/linkshu";

const seedLayer = (seedBytes: Uint8Array) =>
  CashuSeed.fromBytes(Bip39Seed.make(seedBytes));
```

You only build this yourself when assembling layers by hand; `linkshuServices` does it from `config.bip39Seed`. The package is the trust boundary the seed exists for — never derive keys or counters on the platform side.

## In-memory defaults and durability across runtimes

`inMemoryKeyValueStore`, `inMemoryProofStore`, and `inMemoryOperationStore` are `Layer.sync`, so every runtime built from them gets a fresh, empty store. To model a restart (two runtimes over one storage) create the instances once and wrap them with `Layer.succeed`:

```ts
import {
  KeyValueStore,
  makeInMemoryKeyValueStore,
  makeInMemoryOperationStore,
  makeInMemoryProofStore,
  OperationStore,
  ProofStore,
} from "@linky/linkshu";
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

This is what `tests/integration/helpers.ts` calls `durableStorage()`, and what `src/testing/storage.ts` builds as `freshStorage()`.

## Related

- [concepts.md](./concepts.md) — proof states, operation statuses, and the counter lease
- [testing.md](./testing.md) — port contract tests
- [getting-started.md](./getting-started.md) — passing the layers to `runLinkshu`/`linkshuServices`
