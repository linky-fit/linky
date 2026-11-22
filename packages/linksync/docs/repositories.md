# Repositories

One repository per scope, each built over a `LinkyStore`. A repository returns rows merged across shards (one per id, the newest shard's copy) and writes to the active shard; the consumer never names an owner, a table or a shard index.

## `DomainTableRepository`

Every repository over a table is or extends `DomainTableRepository` (`domainTableRepository(store, scope, table)`): `all`, `byId`, `insert`, `insertIfAbsent`, `removeIfAbsent`, `update`, `remove`, `maybeRotate` and `subscribe`. Consumers read and write plain `string`, `number` and `boolean` values alongside the branded domain ids (`ContactId`, `MessageId`, ...); the repository validates and encodes Evolu's column rules (`NonEmptyString*`, `PositiveInt`, `NonNegativeInt`, `SqliteBoolean`) at its boundary and fails with `ShardDbError` when a value does not fit its column. `insert` takes `id` plus the non-nullable columns; nullable ones may be omitted (sparse insert), and it overwrites the active shard's copy of that id, reviving a removed one: use it for a user action. `insertIfAbsent` writes only when no visible shard holds a copy of the id, live or tombstoned, and returns whether it wrote; it writes the columns without marking the row live, so a removal on another device that has not synced yet still wins. Use it for a deterministic id whose row may since have been updated or removed. `removeIfAbsent` records the removal of a row that has not arrived: unless a visible shard holds a copy of the id, it writes the columns given as a tombstone, required ones optional, so a later `insertIfAbsent` of the id is refused. `update` is copy-on-write and fails with `RowNotFound` when no visible shard holds a live copy; `remove` fails with `RowNotFound` when no visible shard holds any copy and is a no-op if the newest copy is already tombstoned. `tableRepository(store, scope, table)` stays available as the low-level Evolu-typed layer underneath.

Every write ends with the rotation check. A pointer write the port rejects does not fail the row write: the repository logs it and the next write repeats the check, so chained writes are never left halfway over bookkeeping.

## Contacts

`makeContactsRepository(store)` is a `DomainTableRepository` over `contact`: profile fields, the user's overrides and the archive state. Read cursors live in [conversations](#conversations). Contacts are never forgotten, so the archive state reaches every device however old it is.

- `archive(id, atSec)` sets `archivedAtSec`; an incoming message newer than it is the consumer's signal to unarchive.
- `unarchive(id)` clears `archivedAtSec` on the contact and on its direct conversation, where older app versions archive; the conversation's fresh copy in the active shard hides any older archived copy. Copy a conversation's archive onto the contact only while the contact has none, and an unarchive is never undone by an older copy.

```ts
import { createId, makeContactsRepository } from "@linky-fit/linksync";
import { Effect } from "effect";

const contacts = makeContactsRepository(store);
const id = createId<"Contact">();

await Effect.runPromise(contacts.insert({ id, name: "Alice" }));
const all = await Effect.runPromise(contacts.all);
```

The repository returns one row per id; deduplicating unsaved peers by npub is the consumer's.

## Hidden and pinned listings

`makeHiddenListingsRepository(store)` and `makePinnedListingsRepository(store)` are `DomainTableRepository`s over `hiddenListing` and `pinnedListing`, in the `contacts` scope: someone else's listings the user hid or pinned to the top, whether or not the author is a contact. `setHidden(author, listingId, hidden)` hides a listing or shows it again, `setPinned(author, listingId, pinned)` pins or unpins it; either writes nothing when the listing is already in that state. Each listing has one row per table, `hiddenListingIdFor(author, listingId)` or `pinnedListingIdFor(author, listingId)`, so marking it on two devices lands on one row, and unmarking removes the row. The two tables are independent; keeping a listing out of both at once is the consumer's. `listingKeysOf(rows)` turns either table's rows into a set to test with `listingKey(author, listingId)`.

## Conversations

`makeConversationsRepository(store)`: conversations with their read cursors, plus `messages` and `reactions`, `DomainTableRepository`s over those two tables. All three live in the `messages` scope, which keeps the newest 4 shards.

- `ensureDirect(contactId)` creates the contact's direct conversation on first use with the derived id `directConversationIdFor(contactId)`. Insert messages with the `conversationId` it returns; messages have no `contactId`. On a device that does not read the scope from its first shard, the conversation's row may sit in a forgotten shard, and the new copy in the active shard wins over it on every device; so the new row starts with its read cursor at `visibleSinceSec`, the same point a missing cursor is read from.
- A message or reaction that arrived over Nostr takes `nostrMessageIdFor(rumorId)` / `nostrReactionIdFor(rumorId, reactor)` and goes in with `insertIfAbsent`, so a second relay, a later session or another device fetching it again neither duplicates it nor resets its edits and status, and a removed one stays removed. The id ignores the conversation, so moving the message to another contact keeps it. An own send is stored before its rumor exists, so its row has a random id; matching rows by rumor id across the two kinds is the consumer's.
- `markSeen(id, atSec)` moves the read cursor forward only; a lower or equal value is ignored, so an idle conversation's row may be forgotten with its old messages. `setPeerSeen(id, window)` updates the peer's seen window (`peerSeenSinceSec`, `peerSeenAtSec`).
- `visibleSinceSec` is when the oldest visible messages shard began, from its earliest row, or `null` while the device reads the scope from shard 0. Reading a newer message moves the conversation's row into a visible shard, so a conversation whose cursor is missing or older has no message newer than this that was read. Treat messages up to it as read, so a forgotten cursor does not make an old conversation unread, and judge newer ones as usual, so a brand-new conversation stays unread.
- A retraction whose reaction is not stored yet goes in as `reactions.removeIfAbsent({ id, reactorPubkey, wrapId })` under `nostrReactionIdFor(rumorId, retractor)`, so the reaction is refused whenever it arrives; a stored one is `remove`d.
- `removedReactions` returns the tombstoned reaction copies in the visible shards, so a removed reaction's wrap id and reactor stay known; a tombstone stored before its reaction has no conversation, message or emoji.
- `archivedAtSec` on a conversation is written only by older app versions; the archive state lives on the [contact](#contacts).

## Unknown senders

`makeUnknownSendersRepository(store)` is a `DomainTableRepository` over `unknownSenderMessage` in the `unknownSenders` scope, which keeps the newest 2 shards: conversations with peers who are not contacts, one row per message, keyed by the sender's `peerPubkey`. A message from Nostr takes `nostrMessageIdFor(rumorId)` and goes in with `insertIfAbsent`, as in [conversations](#conversations). Reactions and seen receipts from unknown senders have no table.

- `moveToContact(peerPubkey, contactId)` runs once the sender is a contact: it inserts each message into the contact's direct conversation with `insertIfAbsent` under the same id, then removes it here, and returns how many left. Repeating it, or another device doing it at the same time, moves nothing twice; a message whose required columns have not synced yet stays until the next call.
- `removeSender(peerPubkey)` removes every message of the sender, for deleting or blocking the conversation.

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

Ids are `cashuProofIdFor(secret)` and `cashuOperationIdFor(operationKeyOf(op))`, so re-inserting a stored proof or operation patches that row with the fields present. A re-inserted proof keeps its `createdAt` and `write` returns it; a new proof's returned `createdAt` is the time of the call, not read back from Evolu. A proof `write` batch, inserts and patches together, is one store `write` (one `mutate`, so one Evolu transaction) and one rotation check. Proof patches and the operation `update` apply only the present fields and are a no-op for an unknown id. Every read returns only rows that decode as `StoredProof` / `StoredOperation` (`toStoredProof`, `toStoredOperation`); a row missing a required column is skipped, not repaired.

`spent` is terminal, so the proof store adds one rule to the core's "highest shard wins" merge: a proof is spent when any copy in any visible shard says so, live or tombstoned. The next `update` patches the winning copy and the copies agree again.

The proof reads never load the whole table. `loadUnspent` reads the copies of the proofs with a live copy in a state other than `spent` (`copiesWhere`), `findByOperation` those with any copy naming the operation, tombstoned ones included because a spent mark may sit there, and `findBySecrets` the copies of the ids the secrets derive; each merges the copies by the rule above, so a spent mark in any copy still wins. `findOldestByKeysets` reads the earliest created copy per keyset, ties going to the lowest mint (`oldestWhere`), and falls back to the keyset's every copy when that one does not validate, so the oldest valid proof still binds it. `allProofs` reads every proof in any state, spent included, for backups rather than wallet decisions. `subscribe` fires on changes to the operations, the pointers and the unspent proofs, not on a write that only touches spent ones; `subscribeOperations(operationIds, listener)` fires on changes to those operations' proofs, spent ones included. The operation store still reads every operation.

## Transactions

`makeTransactionsRepository(store)` over `transaction` in the `transactions` scope, which keeps the newest 4 shards. `all` returns `TransactionRecord`s, not raw rows: `createdAtSec` present, `direction` and `status` narrowed, and `category` derived from `method` by `deriveTransactionCategory`. A row whose event time, direction or status does not validate is skipped until sync completes it (`normalizeTransaction`). There is no `category` or `phase` column to write; sorting and pairing is the consumer's.

A row's id says which event it records, so writing the same event again (a retry, a second tab, another device resuming the same operation) upserts one row instead of adding a duplicate. Build ids with `transactionIdForOperation(operationId)` for anything a linkshu operation carries, `transactionIdForQuote(kind, mint, quoteId)` for a melt or topup known only by its quote (the same id as its operation), `transactionIdForRequest(requestId)` for a payment request, and `transactionIdForRestore(proofIds)` for a restore. The consumer can join a row to its operation by comparing `transactionIdForOperation(operation.id)` with the row id.

## Recurring payments

`makeRecurringPaymentsRepository(store)` over `recurringPayment` in the `contacts` scope, next to the contacts the payments go to; the scope is never forgotten. `all` returns `RecurringPaymentRecord`s: the columns a scheduler acts on (schedule, recipient, `mintUrl`, `rail`, `progress`) are present and non-null, and a row still arriving column by column from sync is skipped until it completes (`normalizeRecurringPayment`).

`progress` holds the count of paid runs and the pending due time as one JSON value, so last-writer-wins sync always leaves a count and a due time that one write made together. The count is also the index of the next run, which names the run at the mint. Write it only as `@linky-fit/recurring-payment` encodes it (`recurringProgressColumn` and the transition patches); this package stores the text.

Insert `mintUrl`, `rail` and the initial `progress` with every new payment. `mintUrl` is the mint every run is paid from and `rail` (`cashu` or `lightning`) how every run reaches the contact; nothing updates either afterwards, so a payment that should change them is removed and created again. `note` is optional and editable; write it only when the user typed one.

`deleted` returns every removed payment with its last `mintUrl`, `rail` and `progress`, so the app can settle the envelope a removed payment left at its mint. A payment that moved to a newer shard is not in it: only the newest copy of each id counts.

`unit`, `intervalUnit`, `rail`, `progress` and `lastRunStatus` stay strings here; their values, the schedule math and the run keys belong to `@linky-fit/recurring-payment`, whose `readRecurringPaymentOrder` validates a record into an order.

## Listings

`makeListingsRepository(store)` over `listing` in the `contacts` scope, which is never forgotten: one row per thing the user offers to, or wants from, their contacts. `all` returns `ListingRecord`s, whose creation time, side, title, amount, currency and unit are present; a row still arriving column by column is skipped (`normalizeListing`).

Adding a listing is `insert` with every column; editing is `update`; withdrawing it is `remove`. `side`, `unit`, `amount` and `currency` stay strings here and are validated into `@linky-fit/linkstr`'s `Listing` by the consumer that publishes them, and so are the optional `description`, the author's text, and `image`, the JSON of linkstr's `PrivateImage`, each left out of an insert when the listing has none; `priceByAgreement` is `true` when a zero `amount` means the price is to be agreed rather than free; `audience` says who sees the listing, as JSON the consumer validates (`{"kind":"network"}` or `{"kind":"group","group":<group name>}`), and is left out for a listing only the contacts see; `pausedAtSec` is set while the user paused the listing, which the consumer then leaves unpublished, and cleared with `null` to resume it; releases before the column ignore it and keep publishing the listing; the row id is the listing's stable id on the wire. The cash intent is the `cashIntent` setting, not a row, and the currencies the user pays proxy payments in are the `proxyPaymentCurrencies` setting.

## Peer listings

`makePeerListingsRepository(store)` over `peerListings` in the `peerListings` scope: the newest listings document of each author who shares one with the user, as one of the user's identities read it, kept so every device shows it while relays do not. `record({ reader, author, document, publishedAtSec })` stores the document JSON only when it was published strictly later than the stored one, so an older or equally old copy from a lagging relay never replaces it; an unchanged document moves only `publishedAtSec`. It returns whether it wrote. `ofReader(reader)` returns that identity's `PeerListingsRecord`s, one per author; a row still arriving column by column is skipped (`normalizePeerListings`). The document stays a string here: the consumer validates it as linkstr's `ListingsDocument`, and stores an author's empty document too, since that is how the author withdraws what they shared. Rows are one per `peerListingsIdFor(reader, author)` and are never removed.

## On-chain transfers

`makeOnchainTransfersRepository(store)` over `onchainTransfer` in the `onchain` scope, which is never forgotten: one row per on-chain transfer, keyed by the `OnchainTransferId` the user created with the request. The user's account and the operator's each keep their own row of a transfer; `role` says which side the account is and `peerPubkey` is the other side. `all` returns `OnchainTransferRecord`s, whose creation time, role, peer, direction, amount and fee are present; a row still arriving column by column is skipped.

- Requesting a transfer is the user's `insert` with the columns the request fixes: `direction`, `amount`, `feeBasisPoints`, and the payout address, refund choice or user payment request its direction needs. The operator stores a received request with `insertIfAbsent`, so a replayed request cannot overwrite a transfer in progress.
- Everything after is `update`: `updateJson` with each newer update, `depositAddress` and `operatorPaymentRequest` once accepted, the operator's `addressIndex` and `ecashSendId` (set while Cashu for the transfer is on its way, so every operator device sees it), the user's `sentAtSec`, `cancelledAtSec` and `payoutTxid` (the payout of an on-chain send Linky found on chain itself; releases before the column ignore it), and the operator's own bookkeeping, which never reaches the user: `closedByHand` (the outcome a transfer was closed with by hand) and `isTest`.

`role`, `direction` and `updateJson` stay strings here; their values, the status rules and the update's JSON belong to `@linky-fit/onchain-transfer`, whose `encodeTransferUpdateColumn` and `decodeTransferUpdateColumn` write and read `updateJson`.

`makeOnchainTransferMessagesRepository(store)` over `onchainTransferMessage` in the same scope keeps, on the operator's account, every on-chain transfer message a user sent, with its content exactly as it arrived, so a dispute can be settled against what was sent. Store each with `insertIfAbsent` under `onchainTransferMessageIdFor(rumorId)`, so a replayed inbox or a second device lands on the same row; `transferId` is the transfer the message names, or `null` for one that does not decode.

## Identity

`makeIdentityRepository(store)` mirrors the active Nostr key in the `identity` scope (one fixed shard, never forgotten) so another device can adopt it. `set` upserts the one row `activeNostrIdentityId`; `current` is the newest row by `updatedAt`, or `null`. `switchedAtSec` is the cutoff after which older incoming events are ignored following a custom override. The row carries the `nsec`; keep it out of logs.

## Settings

`makeSettingsRepository(store)`: small synced values in the app owner, one row per key (`settingIdFor(key)`). `get`, `set` and `remove` operate on keys registered in `LinkySettings`; each key's schema maps its typed value to the stored text. `get` returns the decoded value, or `null` when the row is absent or holds text the schema rejects; `set` encodes the value and fails with `ShardDbError` when the text is empty or over 1000 characters; `remove` is a no-op when absent. Other apps sharing the account (such as Fazole and the on-chain operator) use `getRaw`, `setRaw` and `removeRaw` with their own namespaced keys under the same `setting/<key>` id scheme. Shard pointers share the scope but have their own table; never write them through settings.

A new setting is a new `LinkySettings` entry. Keys and encodings are synced data that older app versions on other devices read, so never rename a key or change its encoding; add a new key instead.

## Inbox cursors

`makeInboxCursorsRepository(store)` keeps each Nostr identity's inbox cursor (a linkstr `UnixSeconds`) as a setting row in the app owner, keyed by pubkey (`inboxCursorSettingIdFor(pubkey)`), so a restored or second device can start its inbox where another device's left off. `get(pubkey)` returns the cursor, or `null` when the row is absent or unreadable; `set(pubkey, cursor)` writes it unconditionally, last writer wins.

The app owner is never rotated and Evolu keeps every write against its quota, so write rarely, and only a cursor this device has fetched up to itself.
