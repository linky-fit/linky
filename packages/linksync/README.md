# @linky/linksync

Linky's synced storage as a typed library. Everything that has to reach
another device through Evolu is defined here: the data model (one Evolu
schema, branded ids), one repository per data scope, and the shard mechanics
that keep every Evolu owner under the relay's per-owner quota. The app calls
repositories and never sees an owner id, a table name, or a shard index.

## Documentation

Usage guides live in [`docs/`](./docs/README.md): start with
[concepts](./docs/concepts.md) for the scope table and the decisions behind
it, then [core](./docs/core.md) for the shard store or the guide for the
repository you need. This README holds the design rules; the guides show how
to call the package.

## Design rules

- **Synced storage, not an Evolu wrapper.** In: anything another device must
  see (contacts, conversations, messages, proofs, operations, transactions,
  the mirrored identity, small synced settings). Out: `localStorage`
  helpers, secrets, the profile cache, linkstr's outbox persistence.
- **Rows merged across shards.** Repositories return persisted rows, one per
  id, from the newest shard that holds a copy. Display transforms stay in the
  app; legacy normalization (a transaction's category from its method, rows
  skipped until their required columns arrive) lives here.
- **Copy-on-write.** An update to a row in a retired shard writes the whole
  row into the active shard and tombstones the old copy, so a shard's size is
  final once it stops being active.
- **Forgetting is a per-scope policy.** Contacts, proofs, and operations are
  never forgotten. Messages and transactions keep the newest shards only.
- **The generic core knows no domain.** `src/core` is scopes, shards,
  pointers, merged reads, rotation, forgetting, and legacy ingest over a
  small `ShardDb` port, tested against an in-memory implementation with a toy
  schema. `src/model` and `src/repositories` are Linky.
- **Evolu 7.4.1 stays contained.** `src/core` imports Evolu only for key
  derivation and ids, `src/model` only for column types, and
  `src/evolu/evoluShardDb.ts` is the sole place the Evolu runtime is
  touched. The official 7 to 8 migration will land in those files.
- **Where code lives.** If a function needs an owner id, a table name, or a
  shard index, it belongs in this package. If it only needs a `ContactRow`,
  it stays in the app.

## Layout

- `src/core/` — scope registry, `ShardDb` port, in-memory port, shard store
- `src/model/` — the Evolu schema, branded ids, the scope table, the store factory
- `src/repositories/` — contacts, conversations (messages, reactions), wallet
  (linkshu's `ProofStore` and `OperationStore`), transactions, identity, settings
- `src/evolu/` — the Evolu 7 adapter, exported as `@linky/linksync/evolu`
- `src/testing/` — package-internal fixtures, excluded from the app build
