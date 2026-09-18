# Concepts

What the package stores, where, and why. The scope table below is the source of truth; `src/model/scopes.ts` encodes it and every later change edits both.

## Decisions

Recorded here and in `docs/architecture.md` at the repo root. Tracked in linky-fit/linky#380.

1. **Package name: `@linky/linksync`.** The family is `linkstr` (nostr) and `linkshu` (cashu); this one is named for what it is, synced storage, not for Evolu.
2. **Rotation is byte-aware and count-aware, whichever fires first.** A shard rotates once its Evolu history holds `SHARD_MAX_BYTES` (256 KiB) of column values or the scope's mutation count (the pre-package thresholds). The byte number is a quarter of the official Evolu relay's 1 MB per-owner quota, because the relay stores encrypted history with per-row overhead that local value bytes do not show. Both numbers are meant to be tuned with real data. A 60 s cooldown per scope stays.
3. **Transactions are forgettable.** Money truth is the proofs and operations, which are never forgotten; the transaction history is a view of it. Messages and transactions keep the newest 4 shards.
4. **Only the meta owner is an Evolu `AppOwner`.** Every other scope is a `ShardOwner` derived with `deriveShardOwner(appOwner, [scope, index])`.
5. **Copy-on-write.** Old shards never grow; see below.
6. **Stay on Evolu 7.4.1.** The Evolu runtime is touched in one file.

## Scope table

| Scope          | Owner                              | Tables                                | Rotates                  | Forget        |
| -------------- | ---------------------------------- | ------------------------------------- | ------------------------ | ------------- |
| `meta`         | `AppOwner` (the only one)          | `shardPointer`, `setting`             | no                       | never         |
| `identity`     | `ShardOwner` `["identity", 0]`     | `nostrIdentity`                       | no                       | never         |
| `contacts`     | `ShardOwner` `["contacts", n]`     | `contact`                             | 256 KiB or 220 mutations | never         |
| `messages`     | `ShardOwner` `["messages", n]`     | `conversation`, `message`, `reaction` | 256 KiB or 160 mutations | keep newest 4 |
| `cashu`        | `ShardOwner` `["cashu", n]`        | `cashuProof`, `cashuOperation`        | 256 KiB or 170 mutations | never         |
| `transactions` | `ShardOwner` `["transactions", n]` | `transaction`                         | 256 KiB or 220 mutations | keep newest 4 |

Copy-on-write identity is the row `id` in every table; the ids that are deterministic are listed under [Ids](#ids).

## Tables

System columns (`id`, `ownerId`, `createdAt`, `updatedAt`, `isDeleted`) are Evolu's; the physical primary key is `(ownerId, id)`. Every non-id column is nullable on read, because a row can arrive column by column from sync; readers validate what they need.

- `shardPointer`: `scope`, `index`, `rotatedAtMs?`. One row per scope with a deterministic id, so every device upserts the same row.
- `setting`: `key`, `value`. Deterministic id per key.
- `nostrIdentity`: `nsec`, `npub?`, `source?` (`derived` | `custom`), `switchedAtSec?`. One row with a deterministic id.
- `contact`: `name?`, `nameSetByUser?`, `npub?`, `lnAddress?`, `lnAddressSetByUser?`, `groupName?`, `groupNamesJson?`. Profile only; `groupName` is contact-list grouping.
- `conversation`: `kind` (`direct` | `group` later), `contactId?`, `participantsJson?`, `archivedAtSec?`, `lastSeenAtSec?`, `peerSeenSinceSec?`, `peerSeenAtSec?`. An active chat travels forward with its cursor updates; a dead one is forgotten with its messages.
- `message`: the former `nostrMessage` with `contactId` replaced by `conversationId`.
- `reaction`: the former `nostrReaction` plus `conversationId`, so a forgotten shard takes its reactions with it. `messageId` still points at `message.rumorId`.
- `cashuProof`, `cashuOperation`: unchanged from the app. There is no `cashuToken`; the migration ingests it into `cashuProof`.
- `transaction`: the former table minus `category` and `phase`.

## How a row moves

- **Insert** writes into the active shard of the scope (the shard the pointer names, or index 0).
- **Update** of a row in the active shard patches it in place. Update of a row in an older shard copies the whole row, patch applied, into the active shard and tombstones the copy where it was. Retired shards therefore receive at most tombstones.
- **Remove** tombstones the row where it lives; nothing is copied.
- **Read** takes every row of the visible shards, keeps one copy per id from the highest shard index, and drops tombstones.
- **Rotate** upserts the scope's pointer to `index + 1`. The device that rotated keeps using the new index until its read model shows it, so a lagging query cannot send writes back to the old shard.
- **Sync** uses the app owner plus every visible shard of every scope; nothing else is subscribed.

## Forgetting

Visible shards are all of them for a `never` scope and the newest N for a `keepNewest: N` scope. A shard outside the window is unsubscribed (a fresh device never downloads it) and, once the port can delete an owner, deleted. Evolu 7 cannot delete an owner yet, so `ShardStore.forget` reports `deleted: false` there; the in-memory port deletes.

## Legacy ingest

Rows in an owner outside a scope's shard set (the old BIP-85 lanes, or an older app version still writing to them) are copied into the active shard by `ShardStore.ingest`. It is idempotent: a row already present with the same or newer `updatedAt` is skipped, and a row the shards have tombstoned is not resurrected. The migration and the mixed-version grace period both use it.

## Ids

| Id                        | Derived from               | Why                                                    |
| ------------------------- | -------------------------- | ------------------------------------------------------ |
| `cashuProofIdFor`         | the proof secret           | a synced or restored proof never duplicates            |
| `cashuOperationIdFor`     | linkshu's `operationKeyOf` | re-inserting an operation upserts its row              |
| `directConversationIdFor` | the contact id             | the migration and every device derive one conversation |
| `settingIdFor`            | the key                    | one row per key                                        |
| `activeNostrIdentityId`   | constant                   | one mirrored identity row                              |
| `shardPointerId`          | the scope name             | one pointer row per scope, upserted by every device    |
| `createId`                | random                     | everything else                                        |

## The migration (#383)

The app's `laneToShardMigration.ts` copies the old owner lanes into the shards with `ShardStore.ingest`; the package only supplies the ids and the ingest. What it decided:

- Transaction `category` is dropped. A legacy row with a category but no method gets the method the category implies: `contacts` becomes `cashu_chat`, `lightning` becomes `lightning_invoice` (the original lightning flow, before addresses). Any other row reads as `cashu` through `deriveTransactionCategory`.
- Identity rows had one id per lane; the newest row is written as `activeNostrIdentityId`.
- One `conversation` row per contact that has chat columns (`archivedAtSec`, `chatLastSeenAtSec`, `chatPeerSeenSinceSec`, `chatPeerSeenAtSec`) or messages, with `directConversationIdFor(contact.id)`; every message's `contactId` becomes that conversation id, and a reaction takes the conversation of the message its `messageId` names (a reaction without a known message is skipped).
- Shard pointers start at index 0 for every rotating scope.
- The grace period for older app versions, its cutoff setting, and the removal gate are recorded in `docs/architecture.md` at the repo root.
