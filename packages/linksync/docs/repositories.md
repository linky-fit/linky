# Repositories

One repository per scope, each built over a `LinkyStore`. A repository returns rows merged across shards (one per id, the newest shard's copy) and writes to the active shard; the consumer never names an owner, a table or a shard index.

## `TableRepository`

`tableRepository(store, scope, table)` is the shape every repository is or extends: `all`, `byId`, `insert`, `insertIfAbsent`, `removeIfAbsent`, `update`, `remove`, `maybeRotate` and `subscribe`. `insert` takes `id` plus the non-nullable columns; nullable ones may be omitted, and it overwrites the active shard's copy of that id, reviving a removed one: use it for a user action. `insertIfAbsent` writes only when no visible shard holds a copy of the id, live or tombstoned, and returns whether it wrote; it writes the columns without marking the row live, so a removal on another device that has not synced yet still wins. Use it for a deterministic id whose row may since have been updated or removed. `removeIfAbsent` records the removal of a row that has not arrived: unless a visible shard holds a copy of the id, it writes the columns given as a tombstone, required ones optional, so a later `insertIfAbsent` of the id is refused. `update` is copy-on-write; `update` and `remove` fail with `RowNotFound` for an id no visible shard holds. Column values are Evolu's branded types (`NonEmptyString1000`, `PositiveInt`, `SqliteBoolean`, ...), re-exported from the package entry.

Every write ends with the rotation check. A pointer write the port rejects does not fail the row write: the repository logs it and the next write repeats the check, so chained writes are never left halfway over bookkeeping.

## Contacts

`makeContactsRepository(store)` is a `TableRepository` over `contact`: profile fields, the user's overrides and the archive state. Read cursors live in [conversations](#conversations). Contacts are never forgotten, so the archive state reaches every device however old it is.

- `archive(id, atSec)` sets `archivedAtSec`; an incoming message newer than it is the consumer's signal to unarchive.
- `unarchive(id)` clears `archivedAtSec` on the contact and on its direct conversation, where older app versions archive; the conversation's fresh copy in the active shard hides any older archived copy. Copy a conversation's archive onto the contact only while the contact has none, and an unarchive is never undone by an older copy.

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

`makeConversationsRepository(store)`: chats with their read cursors, plus `messages` and `reactions`, `TableRepository`s over those two tables. All three live in the `messages` scope, which keeps the newest 4 shards.

- `ensureDirect(contactId)` creates the contact's direct chat on first use with the derived id `directConversationIdFor(contactId)`. Insert messages with the `conversationId` it returns; messages have no `contactId`. On a device that does not read the scope from its first shard, the chat's row may sit in a forgotten shard, and the new copy in the active shard wins over it on every device; so the new row starts with its read cursor at `visibleSinceSec`, the same point a missing cursor is read from.
- A message or reaction that arrived over Nostr takes `nostrMessageIdFor(rumorId)` / `nostrReactionIdFor(rumorId, reactor)` and goes in with `insertIfAbsent`, so a second relay, a later session or another device fetching it again neither duplicates it nor resets its edits and status, and a removed one stays removed. The id ignores the conversation, so moving the message to another contact keeps it. An own send is stored before its rumor exists, so its row has a random id; matching rows by rumor id across the two kinds is the consumer's.
- `markSeen(id, atSec)` moves the cursor forward only; a lower or equal value is ignored, so an idle chat's row may be forgotten with its old messages.
- `visibleSinceSec` is when the oldest visible messages shard began, from its earliest row, or `null` while the device reads the scope from shard 0. Reading a newer message moves the chat's row into a visible shard, so a chat whose cursor is missing or older has no message newer than this that was read. Treat messages up to it as read, so a forgotten cursor does not make an old chat unread, and judge newer ones as usual, so a brand-new chat stays unread.
- A retraction whose reaction is not stored yet goes in as `reactions.removeIfAbsent({ id, reactorPubkey, wrapId })` under `nostrReactionIdFor(rumorId, retractor)`, so the reaction is refused whenever it arrives; a stored one is `remove`d.
- `removedReactions` returns the tombstoned reaction copies in the visible shards, so a removed reaction's wrap id and reactor stay known; a tombstone stored before its reaction has no conversation, message or emoji.
- `archivedAtSec` on a conversation is written only by older app versions; the archive state lives on the [contact](#contacts).

## Unknown senders

`makeUnknownSendersRepository(store)` is a `TableRepository` over `unknownSenderMessage` in the `unknownSenders` scope, which keeps the newest 2 shards: conversations with peers who are not contacts, one row per message, keyed by the sender's `peerPubkey`. A message from Nostr takes `nostrMessageIdFor(rumorId)` and goes in with `insertIfAbsent`, as in [conversations](#conversations). Reactions and seen receipts from unknown senders have no table.

- `moveToContact(peerPubkey, contactId)` runs once the sender is a contact: it inserts each message into the contact's direct conversation with `insertIfAbsent` under the same id, then removes it here, and returns how many left. Repeating it, or another device doing it at the same time, moves nothing twice; a message whose required columns have not synced yet stays until the next call.
- `removeSender(peerPubkey)` removes every message of the sender, for deleting or blocking the chat.

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

A row's id says which event it records, so writing the same event again (a retry, a second tab, another device resuming the same operation) upserts one row instead of adding a duplicate. Build ids with `transactionIdForOperation(operationId)` for anything a linkshu operation carries, `transactionIdForQuote(kind, mint, quoteId)` for a melt or topup known only by its quote (the same id as its operation), `transactionIdForRequest(requestId)` for a payment request, and `transactionIdForRestore(proofIds)` for a restore. The consumer can join a row to its operation by comparing `transactionIdForOperation(operation.id)` with the row id.

## Recurring payments

`makeRecurringPaymentsRepository(store)` over `recurringPayment` in the `contacts` scope, next to the contacts the payments go to; the scope is never forgotten. `all` returns `RecurringPaymentRecord`s: the columns a scheduler acts on (schedule, recipient, `mintUrl`, `rail`, `progress`) are present and non-null, and a row still arriving column by column from sync is skipped until it completes (`normalizeRecurringPayment`).

`progress` holds the count of paid runs and the pending due time as one JSON value, so last-writer-wins sync always leaves a count and a due time that one write made together. The count is also the index of the next run, which names the run at the mint. Write it only as `@linky-fit/recurring-payment` encodes it (`recurringProgressColumn` and the transition patches); this package stores the text.

Insert `mintUrl`, `rail` and the initial `progress` with every new payment. `mintUrl` is the mint every run is paid from and `rail` (`cashu` or `lightning`) how every run reaches the contact; nothing updates either afterwards, so a payment that should change them is removed and created again. `note` is optional and editable; write it only when the user typed one.

`deleted` returns every removed payment with its last `mintUrl`, `rail` and `progress`, so the app can settle the envelope a removed payment left at its mint. A payment that moved to a newer shard is not in it: only the newest copy of each id counts.

`unit`, `intervalUnit`, `rail`, `progress` and `lastRunStatus` stay strings here; their values, the schedule math and the run keys belong to `@linky-fit/recurring-payment`, whose `readRecurringPaymentOrder` validates a record into an order.

## Keryx subscriptions

`makeKeryxSubscriptionsRepository(store)` over `keryxSubscription` in the `keryx` scope, which is never forgotten: one row per company the user paired with, keyed by `keryxSubscriptionIdFor(origin)`, so pairing the same join origin on two devices lands on one row. Pass the join origin as the Keryx protocol canonicalizes it; another spelling derives another id. Announcements are not stored here; each device fetches and caches them itself. `all` returns `KeryxSubscriptionRecord`s, whose origin, trust, identity, channels and pairing time are present; a row still arriving column by column is skipped.

- Pairing is `insert`. Pairing an origin again after `remove`, or again after a rebrand, overwrites its row; write `privateFeedsJson` as `null` when the new pairing has no private feed, so the earlier pairing's feeds do not come back.
- Changing channels, private feeds or the acknowledged identity is `update`, and only a user action changes them. A refresh writes back only `trustJson`, and only trust it has just verified from the network.

The JSON columns hold the Keryx protocol package's Schemas, encoded with `Schema.parseJson`: `trustJson` a `CompanyTrust`, `identityJson` the acknowledged `CompanyIdentity`, `channelsJson` the subscribed public channel names and `privateFeedsJson` the private feeds' capability URLs. A feed's sync state (version, closed) is per device and not stored here, so a device refreshing from an old copy of the row cannot drop a feed another device added. This package stores the columns as given; decoding and verification belong to the Keryx package. `privateFeedsJson` holds capability URLs; keep it out of logs.

## Identity

`makeIdentityRepository(store)` mirrors the active Nostr key in the `identity` scope (one fixed shard, never forgotten) so another device can adopt it. `set` upserts the one row `activeNostrIdentityId`; `current` is the newest row by `updatedAt`, or `null`. `switchedAtSec` is the cutoff after which older incoming events are ignored following a custom override. The row carries the `nsec`; keep it out of logs.

## Settings

`makeSettingsRepository(store)`: small synced values in the app owner, one row per key (`settingIdFor(key)`). Only keys registered in `LinkySettings` compile; each key's schema maps its typed value to the stored text. `get` returns the decoded value, or `null` when the row is absent or holds text the schema rejects; `set` encodes the value and dies when the text is empty or over 1000 characters; `remove` is a no-op when absent. Shard pointers share the scope but have their own table; never write them through settings.

A new setting is a new `LinkySettings` entry. Keys and encodings are synced data that older app versions on other devices read, so never rename a key or change its encoding; add a new key instead.

## Inbox cursors

`makeInboxCursorsRepository(store)` keeps each Nostr identity's inbox cursor (a linkstr `UnixSeconds`) as a setting row in the app owner, keyed by pubkey (`inboxCursorSettingIdFor(pubkey)`), so a restored or second device can start its inbox where another device's left off. `get(pubkey)` returns the cursor, or `null` when the row is absent or unreadable; `set(pubkey, cursor)` writes it unconditionally, last writer wins.

The app owner is never rotated and Evolu keeps every write against its quota, so write rarely, and only a cursor this device has fetched up to itself.
