# Repositories

One repository per scope, each built over a `LinkyStore`. A repository returns rows merged across shards (one per id, the newest shard's copy) and writes to the active shard; the consumer never names an owner, a table or a shard index.

## `TableRepository`

`tableRepository(store, scope, table)` is the shape every repository is or extends: `all`, `byId`, `insert`, `update`, `remove`, `maybeRotate` and `subscribe`. `insert` takes `id` plus the non-nullable columns; nullable ones may be omitted. `update` is copy-on-write; `update` and `remove` fail with `RowNotFound` for an id no visible shard holds. Column values are Evolu's branded types (`NonEmptyString1000`, `PositiveInt`, `SqliteBoolean`, ...), re-exported from the package entry.

Every write ends with the rotation check. A pointer write the port rejects does not fail the row write: the repository logs it and the next write repeats the check, so chained writes are never left halfway over bookkeeping.

## Contacts

`makeContactsRepository(store)` is a plain `TableRepository` over `contact`: profile fields and the user's overrides. Chat state lives in [conversations](#conversations). Contacts are never forgotten.

```ts
import {
  createId,
  makeContactsRepository,
  NonEmptyString1000,
} from "@linky-fit/linksync";
import { Effect } from "effect";

const contacts = makeContactsRepository(store);
const id = createId<"Contact">();

await Effect.runPromise(
  contacts.insert({ id, name: NonEmptyString1000.orThrow("Alice") }),
);
const all = await Effect.runPromise(contacts.all);
```

The repository returns one row per id; deduplicating unsaved peers by npub is the consumer's.

## Conversations

`makeConversationsRepository(store)`: chats with their read cursor and archive state, plus `messages` and `reactions`, `TableRepository`s over those two tables. All three live in the `messages` scope, which keeps the newest 4 shards.

- `ensureDirect(contactId)` creates the contact's direct chat on first use with the derived id `directConversationIdFor(contactId)`. Insert messages with the `conversationId` it returns; messages have no `contactId`.
- `markSeen(id, atSec)` moves the cursor forward only; a lower or equal value is ignored, so an idle chat's row may be forgotten with its old messages.
- `removedReactions` returns the tombstoned reaction copies in the visible shards, so a removed reaction's wrap id stays known.
- Archive is a chat action, so `archive` and `unarchive` live here and not on the contact.

## Wallet

`makeWalletRepository(store)` implements linkshu's `ProofStore` and `OperationStore` ports over the `cashu` scope, which is never forgotten. Give the layers to `linkshuServices` or `runLinkshu`:

```ts
import { makeWalletRepository } from "@linky-fit/linksync";
import { runLinkshu } from "@linky-fit/linkshu";

const wallet = makeWalletRepository(store);
await runLinkshu(
  {
    bip39Seed,
    proofStore: wallet.proofStore,
    operationStore: wallet.operationStore,
  },
  effect,
);
```

Ids are `cashuProofIdFor(secret)` and `cashuOperationIdFor(operationKeyOf(op))`, so re-inserting a stored proof or operation patches that row with the fields present; a proof keeps its `createdAt`, and the insert returns it. A proof insert batch runs one rotation check. Both `update`s apply only the present patch fields and are a no-op for an unknown id. `loadAll` returns every row that decodes as `StoredProof` / `StoredOperation` (`toStoredProof`, `toStoredOperation`); a row missing a required column is skipped, not repaired.

`spent` is terminal, so the proof store adds one rule to the core's "highest shard wins" merge: a proof is spent when any copy in any visible shard says so, live or tombstoned. The next `update` patches the winning copy and the copies agree again.

## Transactions

`makeTransactionsRepository(store)` over `transaction` in the `transactions` scope, which keeps the newest 4 shards. `all` returns `TransactionRecord`s, not raw rows: `createdAtSec` present, `direction` and `status` narrowed, and `category` derived from `method` by `deriveTransactionCategory`. A row whose event time, direction or status does not validate is skipped until sync completes it (`normalizeTransaction`). There is no `category` or `phase` column to write; sorting and pairing is the consumer's.

## Identity

`makeIdentityRepository(store)` mirrors the active Nostr key in the `identity` scope (one fixed shard, never forgotten) so another device can adopt it. `set` upserts the one row `activeNostrIdentityId`; `current` is the newest row by `updatedAt`, or `null`. `switchedAtSec` is the cutoff after which older incoming events are ignored following a custom override. The row carries the `nsec`; keep it out of logs.

## Settings

`makeSettingsRepository(store)`: small synced key/value state in the app owner, one row per key (`settingIdFor(key)`). `get` returns the value or `null`; `set` takes 1 to 1000 characters and dies on an empty value; `remove` is a no-op when absent. Shard pointers share the scope but have their own table; never write them through settings.
