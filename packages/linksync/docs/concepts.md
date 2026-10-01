# Concepts

What the package stores, where, and how a row moves between shards.

## Scopes

A scope is one kind of data with one storage policy. `meta` lives in the Evolu `AppOwner`, the only one; every other scope lives in `ShardOwner`s derived with `deriveShardOwner(appOwner, [scope, index])`. The registry is `linkyScopes`; this table renders it.

| Scope          | Owner                              | Tables                                | Rotates                  | Forget        |
| -------------- | ---------------------------------- | ------------------------------------- | ------------------------ | ------------- |
| `meta`         | `AppOwner`                         | `shardPointer`, `setting`             | no                       | never         |
| `identity`     | `ShardOwner` `["identity", 0]`     | `nostrIdentity`                       | no                       | never         |
| `contacts`     | `ShardOwner` `["contacts", n]`     | `contact`                             | 256 KiB or 220 mutations | never         |
| `messages`     | `ShardOwner` `["messages", n]`     | `conversation`, `message`, `reaction` | 256 KiB or 160 mutations | keep newest 4 |
| `cashu`        | `ShardOwner` `["cashu", n]`        | `cashuProof`, `cashuOperation`        | 256 KiB or 170 mutations | never         |
| `transactions` | `ShardOwner` `["transactions", n]` | `transaction`                         | 256 KiB or 220 mutations | keep newest 4 |

A shard rotates once its Evolu history holds `SHARD_MAX_BYTES` (256 KiB) of column values or the scope's mutation count, whichever comes first, with `SHARD_ROTATION_COOLDOWN_MS` (60 s) between rotations of one scope. The byte threshold is a quarter of the official Evolu relay's 1 MB per-owner quota, leaving room for encryption and per-row overhead. Rotation moves a pointer; nothing is copied.

Money truth is the proofs and operations, never forgotten; the transaction history is a view of it and forgettable.

## Tables

`LinkySchema` holds the columns and their comments. Every non-id column is nullable on read, because a row can arrive column by column from sync; readers validate what they need. `shardPointer`, `setting` and `nostrIdentity` have deterministic ids ([below](#ids)) so every device upserts the same row. `message` and `reaction` carry `conversationId`, so a forgotten shard takes a chat's messages and reactions together.

## How a row moves

- `insert` writes into the active shard of the scope (the shard the pointer names, or index 0).
- `update` of a row in the active shard patches it in place. Update of a row in an older shard copies the whole row, patch applied, into the active shard and tombstones the copy where it was. Retired shards therefore receive at most tombstones.
- `remove` tombstones the row where it lives; nothing is copied.
- A read takes every row of the visible shards, keeps one copy per id from the highest shard index, and drops tombstones.
- `rotate` upserts the scope's pointer to `index + 1`. The device that rotated keeps using the new index until its read model shows it, so a lagging query cannot send writes back to the old shard.
- Sync uses the app owner plus every visible shard of every scope; nothing else is subscribed.

## Forgetting

A forgettable scope keeps its newest N shards, the active one included. Messages keep 4: three retired shards of recent context after a rotation, and a fresh device's initial chat history bounded to roughly 1 MiB of local value bytes at the byte threshold. It is not a message-count or age guarantee.

A fresh device reads and subscribes only the newest N shards. An existing device retains its older locally held shards across rotations and reloads until an explicit forget, remembered through the device-local `ShardRetention` port ([core](./core.md#device-local-retention)). `ShardStore.forget(scope?)` narrows one scope, or every forgettable scope, to its newest window and notifies readers. Evolu 7 only unsubscribes and hides the older rows (`deleted: false`); local bytes and relay history remain until Evolu can delete an owner. The in-memory port deletes.

A cursor update copies the conversation into the active messages shard; `markSeen` only writes for a newer message, so an idle chat's state may be forgotten with its old messages. A contact itself is never forgotten.

## Ids

Copy-on-write identity is the row `id`. These ids are deterministic, so every device lands on one row:

| Id                        | Derived from               | Why                                                 |
| ------------------------- | -------------------------- | --------------------------------------------------- |
| `cashuProofIdFor`         | the proof secret           | a synced or restored proof never duplicates         |
| `cashuOperationIdFor`     | linkshu's `operationKeyOf` | re-inserting an operation upserts its row           |
| `directConversationIdFor` | the contact id             | every device derives one conversation per contact   |
| `settingIdFor`            | the key                    | one row per key                                     |
| `activeNostrIdentityId`   | constant                   | one mirrored identity row                           |
| `shardPointerId`          | the scope name             | one pointer row per scope, upserted by every device |
| `createId`                | random                     | everything else                                     |
