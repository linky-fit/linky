# Concepts

What the package stores, where, and how a row moves between shards.

## Scopes

A scope is one kind of data with one storage policy. `meta` lives in the Evolu `AppOwner`, the only one; every other scope lives in `ShardOwner`s derived with `deriveShardOwner(appOwner, [scope, index])`. The registry is `linkyScopes`; this table renders it.

| Scope            | Owner                                | Tables                                                                     | Rotates                  | Forget        |
| ---------------- | ------------------------------------ | -------------------------------------------------------------------------- | ------------------------ | ------------- |
| `meta`           | `AppOwner`                           | `shardPointer`, `setting`                                                  | no                       | never         |
| `identity`       | `ShardOwner` `["identity", 0]`       | `nostrIdentity`                                                            | no                       | never         |
| `contacts`       | `ShardOwner` `["contacts", n]`       | `contact`, `recurringPayment`, `listing`, `hiddenListing`, `pinnedListing` | 256 KiB or 220 mutations | never         |
| `peerListings`   | `ShardOwner` `["peerListings", n]`   | `peerListings`                                                             | 256 KiB or 160 mutations | keep newest 2 |
| `messages`       | `ShardOwner` `["messages", n]`       | `conversation`, `message`, `reaction`                                      | 256 KiB or 160 mutations | keep newest 4 |
| `unknownSenders` | `ShardOwner` `["unknownSenders", n]` | `unknownSenderMessage`                                                     | 256 KiB or 160 mutations | keep newest 2 |
| `cashu`          | `ShardOwner` `["cashu", n]`          | `cashuProof`, `cashuOperation`                                             | 256 KiB or 170 mutations | never         |
| `transactions`   | `ShardOwner` `["transactions", n]`   | `transaction`                                                              | 256 KiB or 220 mutations | keep newest 4 |
| `keryx`          | `ShardOwner` `["keryx", n]`          | `keryxSubscription`                                                        | 256 KiB or 220 mutations | never         |
| `onchain`        | `ShardOwner` `["onchain", n]`        | `onchainTransfer`, `onchainTransferMessage`                                | 256 KiB or 220 mutations | never         |

A shard rotates once its Evolu history holds `SHARD_MAX_BYTES` (256 KiB) of column values or the scope's mutation count, whichever comes first, with `SHARD_ROTATION_COOLDOWN_MS` (60 s) between rotations of one scope. The byte threshold is a quarter of the official Evolu relay's 1 MB per-owner quota, leaving room for encryption and per-row overhead. Rotation moves a pointer; nothing is copied.

Money truth is the proofs and operations, never forgotten; the transaction history is a view of it and forgettable.

Peer listings are a copy of what relays serve, kept so every device shows a contact's last document while relays do not; a document unchanged long enough to sit only in an older shard stays on the devices that hold that shard, and a fresh device reads it from the relays.

## Tables

`LinkySchema` holds the columns and their comments. Every non-id column is nullable on read, because a row can arrive column by column from sync; readers validate what they need. `shardPointer`, `setting` and `nostrIdentity` have deterministic ids ([below](#ids)) so every device upserts the same row. `message` and `reaction` carry `conversationId`, so a forgotten shard takes a conversation's messages and reactions together. An unknown sender's message is stored like a message of a conversation but filed under its sender, so it moves into the conversation unchanged once the sender becomes a contact.

## How a row moves

- `insert` writes into the active shard of the scope (the shard the pointer names, or index 0). A repository's `insert` also marks the row live, reviving a removed copy; `insertIfAbsent` and `ingest` write only the columns, so a removal from another device that syncs later still wins.
- `update` of a row in the active shard patches it in place. Update of a row in an older shard copies the whole row, patch applied, into the active shard and tombstones the copy where it was. Retired shards therefore receive at most tombstones.
- `write(scope, table, writes)` does what non-reviving `insert` and `update` would for each row of a batch, in order, and issues it all as one `mutate`, so the batch lands whole or not at all. An update of an id with no live copy is skipped instead of failing, and an update may follow the insert of its row in the same batch.
- `remove` tombstones the row where it lives (or is a no-op if the newest copy is already tombstoned); nothing is copied.
- `ingest` copies rows from outside the shards, such as legacy owners, into the active shard. It fills each shard only up to the scope's rule and rotates past the cooldown, so a history of any size spreads over as many shards as it needs.
- `insertRemoved` writes a tombstone into the active shard for a row that has not arrived yet, so a later insert of that id can be refused. It carries only the columns given.
- A read takes every row of the visible shards, keeps one copy per id from the highest shard index, and drops tombstones.
- `rotate` upserts the scope's pointer to `index + 1`. The device that rotated keeps using the new index until its read model shows it, so a lagging query cannot send writes back to the old shard.
- Sync uses the app owner plus every visible shard of every scope; nothing else is subscribed.

## Forgetting

A forgettable scope keeps its newest N shards, the active one included. Messages keep 4: three retired shards of recent context after a rotation, and a fresh device's initial conversation history bounded to roughly 1 MiB of local value bytes at the byte threshold. It is not a message-count or age guarantee.

Messages from unknown senders keep 2, so spam from unknown senders neither grows the conversation history nor stays in it: a rotation still leaves the previous shard's messages visible, and a fresh device reads at most roughly 512 KiB of them. They rotate on the messages thresholds because their rows have the same shape. `messageScopes` lists the two scopes that hold messages, which a user forgets together.

A fresh device reads and subscribes only the newest N shards. An existing device retains its older locally held shards across rotations and reloads until an explicit forget, remembered through the device-local `ShardRetention` port ([core](./core.md#device-local-retention)). `ShardStore.forget(scope?)` narrows one scope, or every forgettable scope, to its newest window: it deletes each forgotten shard owner locally (rows and history, including any leftover rows below an earlier retention boundary) in ascending order, persists retention only after each confirmed deletion, unsubscribes deleted owners in every tab and notifies readers; Evolu relay history remains.

A cursor update copies the conversation into the active messages shard; `markSeen` only writes for a newer message, so an idle conversation's read cursors may be forgotten with its old messages. Every cursor written since the oldest visible shard began is visible, so a consumer can treat messages up to `visibleSinceSec` ([repositories](./repositories.md#conversations)) as read. The archive state lives on the contact, which is never forgotten, so every device sees which conversations are archived. A recurring payment is never forgotten either: a removed one's tombstone still names the envelope it may have left at its mint.

## Ids

Copy-on-write identity is the row `id`. These ids are deterministic, so every device lands on one row:

| Id                            | Derived from                                    | Why                                                                                                  |
| ----------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `cashuProofIdFor`             | the proof secret                                | a synced or restored proof never duplicates                                                          |
| `cashuOperationIdFor`         | linkshu's `operationKeyOf`                      | re-inserting an operation upserts its row                                                            |
| `directConversationIdFor`     | the contact id                                  | every device derives one conversation per contact                                                    |
| `nostrMessageIdFor`           | the message's rumor id                          | a message fetched again stays one row, in either message table                                       |
| `nostrReactionIdFor`          | the reaction's rumor id and reactor             | a reaction fetched again stays one row; a removal stored first applies only to its author's reaction |
| `keryxSubscriptionIdFor`      | the company's join origin                       | pairing a company on two devices lands on one row                                                    |
| `hiddenListingIdFor`          | the author pubkey and listing id                | hiding a listing on two devices lands on one row                                                     |
| `pinnedListingIdFor`          | the author pubkey and listing id                | pinning a listing on two devices lands on one row                                                    |
| `peerListingsIdFor`           | the reader and the author pubkeys               | one author's document as one identity reads it is one row on every device                            |
| `onchainTransferMessageIdFor` | the message's rumor id                          | a replayed or synced on-chain transfer message lands on one row                                      |
| `transactionIdForOperation`   | the operation id (also `transactionIdForQuote`) | retries and multi-device updates land on one transaction row                                         |
| `transactionIdForRequest`     | the payment request id                          | one transaction row per payment request                                                              |
| `transactionIdForRestore`     | the sorted restored proof ids                   | one transaction row per restore batch                                                                |
| `settingIdFor`                | the key                                         | one row per key                                                                                      |
| `inboxCursorSettingIdFor`     | the identity pubkey                             | one inbox cursor setting row per identity                                                            |
| `activeNostrIdentityId`       | constant                                        | one mirrored identity row                                                                            |
| `shardPointerId`              | the scope name                                  | one pointer row per scope, upserted by every device                                                  |
| `createId`                    | random                                          | everything else                                                                                      |
