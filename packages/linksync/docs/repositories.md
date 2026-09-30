# Repositories

One repository per scope (`src/repositories/`), each built over a `LinkyStore`. A repository returns rows merged across shards and writes to the active shard; the consumer never names an owner, a table or a shard index.

## `TableRepository`

`tableRepository(store, scope, table)` is the shape every repository is or extends:

| Method                | Contract                                                                                      |
| --------------------- | --------------------------------------------------------------------------------------------- |
| `all`                 | Every live row, merged across the visible shards, one per id.                                 |
| `byId(id)`            | The row or `null`.                                                                            |
| `insert(row)`         | `id` plus the non-nullable columns; nullable ones may be omitted. Writes to the active shard. |
| `update(id, patch)`   | Copy-on-write; `RowNotFound` for an id no visible shard holds.                                |
| `remove(id)`          | Tombstone; `RowNotFound` for an unknown id.                                                   |
| `maybeRotate`         | The rotation check every write ends with; a batch of raw store writes runs it once.           |
| `subscribe(listener)` | Fires after any change to the scope's tables or pointer, and after explicit forgetting.       |

Column values are Evolu's branded types (`NonEmptyString1000`, `PositiveInt`, `SqliteBoolean`, ...), re-exported from the package entry. A pointer write the port rejects does not fail the row write: the repository logs it (`Effect.logWarning`) and the next write repeats the check, so chained writes are never left halfway over bookkeeping.

## Contacts

`makeContactsRepository(store)` (`contacts.ts`) is a plain `TableRepository` over `contact` in the `contacts` scope: profile fields and the user's overrides. Chat state lives in [conversations](#conversations). Contacts are never forgotten.

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

`makeConversationsRepository(store)` (`conversations.ts`): chats with their read cursor and archive state, plus the messages and reactions in them. All three tables live in the `messages` scope, which keeps the newest 4 shards. It is a `TableRepository` over `conversation` plus:

| Method                                 | Contract                                                                                       |
| -------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `ensureDirect(contactId)`              | The contact's direct chat, created on first use with `directConversationIdFor(contactId)`.     |
| `forContact(contactId)`                | The direct chat or `null`.                                                                     |
| `messagesIn(id)` / `reactionsIn(id)`   | Rows of one conversation, unsorted.                                                            |
| `removedReactions`                     | Tombstoned reaction copies in the visible shards, so a removed reaction's wrap id stays known. |
| `markSeen(id, atSec)`                  | Moves `lastSeenAtSec` forward; a lower or equal value is ignored.                              |
| `setPeerSeen(id, { sinceSec, atSec })` | The peer's seen window from their latest read receipt.                                         |
| `archive(id, atSec)` / `unarchive(id)` | Archive is a chat action, so it lives here and not on the contact.                             |
| `messages`, `reactions`                | `TableRepository`s over `message` and `reaction`.                                              |

Insert messages with the `conversationId` from `ensureDirect`; messages have no `contactId`.

## Wallet

`makeWalletRepository(store)` (`wallet.ts`) implements linkshu's `ProofStore` and `OperationStore` ports over the `cashu` scope, which is never forgotten. Give the layers to `linkshuServices` or `runLinkshu`:

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

| Member                         | Contract                                                                                                                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `proofs`, `proofStore`         | `ProofStoreService` and its `Layer`. Ids are `cashuProofIdFor(secret)`; inserting a stored secret upserts that row and keeps its `createdAt`. One rotation check per `insert` batch. |
| `operations`, `operationStore` | `OperationStoreService` and its `Layer`. Ids are `cashuOperationIdFor(operationKeyOf(op))`; re-insert replaces every field.                                                          |
| `subscribe(listener)`          | Fires after any change to the scope.                                                                                                                                                 |

Both `update`s apply only the present patch fields and are a no-op for an unknown id. `loadAll` returns every row that decodes as `StoredProof` / `StoredOperation` (`toStoredProof` and `toStoredOperation`, exported, return `null` otherwise); a row missing a required column is skipped, not repaired. A proof insert returns the persisted row's creation time, the same on re-insert.

`spent` is terminal, so the proof store adds one rule to the core's "highest shard wins" merge: `loadAll` reads every copy across the visible shards (`ShardStore.copies`) and reports a proof as spent when any copy says so, live or tombstoned. That covers two devices writing the same proof into different shards around a rotation, and a copy-forward that tombstones a copy the other device marks spent afterwards; the next `update` patches the winning copy and the copies agree again.

## Transactions

`makeTransactionsRepository(store)` (`transactions.ts`) over `transaction` in the `transactions` scope, which keeps the newest 4 shards. `insert`, `update`, `remove`, `byId`, `maybeRotate` and `subscribe` are the `TableRepository` methods.

`all` returns `TransactionRecord`s, not raw rows: `createdAtSec` present, `direction` narrowed to `in | out`, `status` to `ok | pending | error | declined`, and `category` derived from `method` by `deriveTransactionCategory` (`cashu_chat` is `contacts`, `lightning_address` and `lightning_invoice` are `lightning`, everything else `cashu`). A row whose event time, direction or status does not validate is skipped until sync completes it (`normalizeTransaction`, exported). There is no `category` or `phase` column to write; sorting and pairing is the consumer's.

## Identity

`makeIdentityRepository(store)` (`identity.ts`) mirrors the active Nostr key in the `identity` scope (one fixed shard, never forgotten) so another device can adopt it.

| Method                                          | Contract                                             |
| ----------------------------------------------- | ---------------------------------------------------- |
| `current`                                       | The newest identity row by `updatedAt`, or `null`.   |
| `set({ nsec, npub?, source?, switchedAtSec? })` | Upserts the one row with id `activeNostrIdentityId`. |
| `subscribe(listener)`                           | Fires after any change.                              |

`source` is `derived` or `custom`; `switchedAtSec` is the cutoff after which older incoming events are ignored following a custom override. The row carries the `nsec`; keep it out of logs.

## Settings

`makeSettingsRepository(store)` (`settings.ts`): small synced key/value state in the app owner.

| Method                | Contract                                                     |
| --------------------- | ------------------------------------------------------------ |
| `get(key)`            | The value or `null`.                                         |
| `set(key, value)`     | Upserts the row `settingIdFor(key)`. Value up to 1000 chars. |
| `remove(key)`         | Tombstones; no-op when absent.                               |
| `subscribe(listener)` | Fires after any change to the `meta` scope.                  |

Shard pointers share the scope but have their own table; never write them through settings.
