# @linky/linksync guides

How to use Linky's synced storage library. These are guides, not an API reference: the exported types are the reference, and the [package README](../README.md) holds the design rules and rationale.

## Where to start

1. [Concepts](./concepts.md) — the decisions, the scope table, how a row moves between shards, and what "forget" means. Read this first.
2. [Core](./core.md) — the generic shard store: scopes, pointers, copy-on-write, merged reads, rotation, the subscribe set, forgetting, legacy ingest.
3. The guide for the repository you need, from the list below.

## Repositories

- [Contacts](./contacts.md) — profiles and user overrides
- [Conversations](./conversations.md) — chats, read cursors, archive state, messages, reactions
- [Wallet](./wallet.md) — linkshu's `ProofStore` and `OperationStore` over the cashu scope
- [Transactions](./transactions.md) — the payment history, normalized
- [Recurring payments](./recurring-payments.md) — standing instructions to pay a contact on a schedule
- [Identity](./identity.md) — the mirrored active Nostr key
- [Settings](./settings.md) — small synced key/value state

## Integrating the package

- [React](./react.md): `useRepositoryRows` and `useVisibleShards` from `@linky/linksync/react`
- [Ports](./ports.md) — the `ShardDb` port, the in-memory implementation, the Evolu 7 adapter
- [Testing](./testing.md) — the in-memory store, fixtures, what the package tests

## Finding your way

- Looking for a type or method name? Open `src/index.ts` and follow the export; every guide names the file it documents.
- Wondering which shard a row is in? You should not have to; if a repository does not answer your question, the missing function belongs in this package, not in the app.
