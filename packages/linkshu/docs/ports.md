# Ports

How to implement the three platform ports so linkshu can run on your storage. You need this when bringing the package to a new platform, or when changing the web app's Evolu/localStorage adapters.

## Overview

A port is an Effect `Context.Tag`; you satisfy it with a `Layer` that builds the service object. Ports are deliberately dumb: they persist what they are given and decide nothing.

| Port            | Tag                     | Layer helper                      | In-memory default       |
| --------------- | ----------------------- | --------------------------------- | ----------------------- |
| `KeyValueStore` | `linkshu/KeyValueStore` | `Layer.sync(KeyValueStore, make)` | `inMemoryKeyValueStore` |
| `TokenStore`    | `linkshu/TokenStore`    | `Layer.sync(TokenStore, make)`    | `inMemoryTokenStore`    |
| `CashuSeed`     | `linkshu/CashuSeed`     | `CashuSeed.fromBytes(bip39Seed)`  | none (always yours)     |

`linkshuServices(config)` and `runLinkshu(config, …)` build `CashuSeed` from `config.bip39Seed` and fall back to the in-memory stores when you omit `keyValueStore`/`tokenStore`.

Two complete, short implementations to copy from:

- `apps/linkshu-cli/src/fileKeyValueStore.ts` and `fileTokenStore.ts` — one JSON file each, safe across processes.
- `apps/web-app/src/platform/linkshu/localStorageKeyValueStore.ts` and `evoluTokenStore.ts` — the browser adapters.

## `KeyValueStore`

Durable string storage plus two lease primitives. Every method returns an `Effect` that must not fail (`Effect.Effect<…>` with `never` error); throw only for genuine storage corruption.

| Method                        | Contract                                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `get(key)`                    | Stored value or `null`.                                                                                                        |
| `set(key, value)`             | Durable write.                                                                                                                 |
| `remove(key)`                 | Delete; no-op if absent.                                                                                                       |
| `listKeys(prefix)`            | All stored keys starting with `prefix`. Drives seed-bound wipes and pending-record scans.                                      |
| `tryAcquireLease(key, ttlMs)` | Atomically claim `key` for `ttlMs`; return a fresh `LeaseId`, or `null` if a live lease is held. Expired leases are claimable. |
| `releaseLease(key, lease)`    | Delete the lease only if `lease` is still the live one; otherwise no-op.                                                       |

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

## `TokenStore`

A row store. The package holds no row cache: it calls `loadAll` before every decision, so `loadAll` must reflect your own earlier `insert`/`update`/`remove` calls immediately, even when the underlying database commits asynchronously (the web app's Evolu adapter keeps a write overlay for exactly this reason).

| Method                | Contract                                                                                                        |
| --------------------- | --------------------------------------------------------------------------------------------------------------- |
| `insert(NewTokenRow)` | Assign the `id` and `createdAt`, persist, return the `StoredTokenRow`. Ids may derive from `originalTokenText`. |
| `update(id, patch)`   | Apply only the present fields of `TokenRowPatch` (`tokenText`, `state`, `error`). Unknown id: no-op.            |
| `remove(id)`          | May be a soft delete; removed rows never reappear in `loadAll`.                                                 |
| `loadAll`             | Every live row. An `Effect` value, not a function.                                                              |

`StoredTokenRow`:

| Field               | Type             | Notes                                                              |
| ------------------- | ---------------- | ------------------------------------------------------------------ |
| `id`                | `TokenRowId`     | Stable; the package refers to rows by it                           |
| `originalTokenText` | `TokenText`      | Encoding the row was created from; dedup identity, never rewritten |
| `tokenText`         | `TokenText`      | Current spendable encoding; rewritten by swaps and validation      |
| `state`             | `TokenState`     | Written only by the package                                        |
| `error`             | `string \| null` | Serialized tagged error; `null` outside `error`                    |
| `createdAt`         | `UnixSeconds`    | Assigned on insert                                                 |

**The platform never decides states.** Do not default, normalize, or "fix" a state on write. Do not delete rows on your own judgement (the web app's delete confirmation is the one exception and calls `remove` explicitly). If a legacy row cannot be represented — its text is not a cashu token — skip it in `loadAll` rather than invent one.

The CLI's `fileTokenStore.ts` is the shortest real one: a JSON array of `StoredTokenRow`, written through the same `file.modify` as above:

```ts
insert: (row) =>
  Effect.flatMap(Clock.currentTimeMillis, (millis) =>
    file.modify((rows) => {
      const stored = new StoredTokenRow({
        id: TokenRowId.make(crypto.randomUUID()),
        originalTokenText: row.originalTokenText,
        tokenText: row.tokenText,
        state: row.state,
        error: row.error,
        createdAt: UnixSeconds.make(Math.floor(millis / 1000)),
      });
      return [[...rows, stored], stored];
    }),
  ),
```

**Deterministic ids.** A store may derive `id` from `originalTokenText` (the web app's Evolu adapter does). Then inserting the same original text again is an upsert onto the same row — it overwrites, and revives a soft-deleted row — and updates to a removed row are ignored. The package is written for both id models; if yours is deterministic, run your flows against `deterministicIdTokenStore` from `src/testing` ([testing.md](./testing.md)) to see the same collisions.

## `CashuSeed`

```ts
import { Bip39Seed, CashuSeed } from "@linky/linkshu";

const seedLayer = (seedBytes: Uint8Array) =>
  CashuSeed.fromBytes(Bip39Seed.make(seedBytes));
```

You only build this yourself when assembling layers by hand; `linkshuServices` does it from `config.bip39Seed`. The package is the trust boundary the seed exists for — never derive keys or counters on the platform side.

## In-memory defaults and durability across runtimes

`inMemoryKeyValueStore` and `inMemoryTokenStore` are `Layer.sync`, so every runtime built from them gets a fresh, empty store. To model a restart (two runtimes over one storage) create the instances once and wrap them with `Layer.succeed`:

```ts
import {
  KeyValueStore,
  makeInMemoryKeyValueStore,
  makeInMemoryTokenStore,
  TokenStore,
} from "@linky/linkshu";
import { Layer } from "effect";

const kv = makeInMemoryKeyValueStore();
const tokens = makeInMemoryTokenStore();
const layers = {
  keyValueStore: Layer.succeed(KeyValueStore, kv),
  tokenStore: Layer.succeed(TokenStore, tokens),
};
```

This is what `tests/integration/helpers.ts` calls `durableStorage()`.

## Related

- [concepts.md](./concepts.md) — row states and the counter lease
- [testing.md](./testing.md) — port contract tests and the deterministic-id store
- [getting-started.md](./getting-started.md) — passing the layers to `runLinkshu`/`linkshuServices`
