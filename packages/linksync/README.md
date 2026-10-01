# @linky-fit/linksync

Synced storage for Linky: the Evolu schema with branded ids, one repository per data scope, and the shard mechanics that keep every Evolu owner under the relay's per-owner quota. A consumer calls repositories and never sees an owner id, a table name or a shard index.

Entry points: `@linky-fit/linksync` (schema, ids, store, repositories, ports), `@linky-fit/linksync/evolu` (the Evolu 7 adapter) and `@linky-fit/linksync/react` (hooks; React is a peer dependency of this entry only).

## What belongs here

- Anything another device must see. Device-local storage, secrets and caches stay out.
- A function that needs an owner id, a table name or a shard index. One that only needs a row stays in the consumer.
- Legacy normalization of stored rows. Display transforms stay in the consumer.

## Guides

The exported types are the reference; the guides say what to call, in which order, and what each call guarantees.

1. [Concepts](./docs/concepts.md): the scope table, how a row moves between shards, forgetting, deterministic ids. Read first.
2. [Core](./docs/core.md): creating a store, its lifecycle, rotation, device-local retention.
3. [Repositories](./docs/repositories.md): one repository per scope; what most code calls.
4. [Ports](./docs/ports.md): the `ShardDb` contract, the in-memory port (also for a consumer's tests), the Evolu 7 adapter.
5. [React](./docs/react.md): binding a component to a repository or a store query.
