# @linky-fit/linksync

Synced storage for Linky as a typed library: one Evolu schema with branded
ids, one repository per data scope, and the shard mechanics that keep every
Evolu owner under the relay's per-owner quota. A consumer calls repositories
and never sees an owner id, a table name, or a shard index.

## Design rules

- **Synced storage, not an Evolu wrapper.** In: anything another device must
  see. Out: device-local storage, secrets, caches.
- **Needs an owner id, belongs here.** A function that needs an owner id, a
  table name, or a shard index lives in this package; one that only needs a
  row stays in the consumer.
- **Rows merged across shards.** A repository returns one row per id, the
  copy from the newest shard that holds it. Legacy normalization lives here;
  display transforms do not.
- **Copy-on-write.** An update to a row in a retired shard writes the whole
  row into the active shard and tombstones the old copy, so a retired shard
  never grows.
- **Forgetting is a per-scope policy.** Contacts, the wallet and the identity
  are never forgotten; messages and transactions keep the newest shards on a
  fresh device, and an existing device keeps what it holds until an explicit
  forget.
- **The core knows no domain.** `src/core` is scopes, shards, pointers,
  merged reads, rotation, forgetting and legacy ingest over a small `ShardDb`
  port, tested against an in-memory implementation with a toy schema.
- **Evolu 7 stays contained in the adapter.** `src/evolu/evoluShardDb.ts` is
  the only file that touches the Evolu runtime; the rest imports Evolu for
  key derivation, ids and column types only.

## Layout

- `src/core/` — scope registry, `ShardDb` port, in-memory port, shard store
- `src/model/` — the Evolu schema, branded ids, the scope registry
  (`scopes.ts`: the source of truth for owner types, rotation rules and
  forget policies), the store factory
- `src/repositories/` — contacts, conversations, wallet, transactions,
  identity, settings
- `src/evolu/` — the Evolu 7 adapter, `@linky-fit/linksync/evolu`
- `src/react/` — hooks, `@linky-fit/linksync/react`
- `src/testing/` — package-internal fixtures, excluded from the app build

## Documentation

The exported types are the API reference; the guides show how to call the
package and state its guarantees.

1. [Concepts](./docs/concepts.md) — scope table, tables, how a row moves,
   forgetting, ids. Read first.
2. [Core](./docs/core.md) — the generic shard store: scopes, store API,
   rotation, retention.
3. [Repositories](./docs/repositories.md) — `TableRepository` and the six
   repositories.
4. [Ports](./docs/ports.md) — the `ShardDb` contract, in-memory port, Evolu 7
   adapter.
5. [React](./docs/react.md) — `useRepositoryRows`, `useVisibleShards`,
   `useLiveValue`.
6. [Testing](./docs/testing.md) — a store over the in-memory port in a
   consumer's tests.
