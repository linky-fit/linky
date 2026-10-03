# @linky-fit/linkstr

Typed Nostr messaging, profiles and relay services, built on [Effect](https://effect.website). Every operation is a service that takes a draft and returns a receipt. Everything inbound arrives on one stream as a tagged union of facts. Raw Nostr events never cross the package boundary, so you never import `nostr-tools`.

## Install

```bash
bun add @linky-fit/linkstr effect
```

ESM with TypeScript declarations, for Node 22.14+ and browser bundlers. `@linky-fit/linkstr/testing` needs Vitest 4 (an optional peer dependency); the main entry does not.

## What is in the box

- Gift-wrapped verticals (NIP-17/NIP-59): `Chat`, `Reactions`, `SeenReceipts`, `PaymentNotices`, `PaymentTelemetry`, `BankOffers`.
- Plain signed events: `Profiles` and `ProfileWatch`, `RelayLists`, `MuteList`.
- NIP-58 supporter badges and the gift-wrapped supporter result: `SupporterBadges`.
- HTTP auth codecs, signed and never published: Blossom upload auth, NIP-98 headers, push ownership proofs.
- Shared machinery: `WrapInbox` (the one kind-1059 subscription), `Outbox` (durable send queue with retries), `PushInbox` (wrap routing for push servers), `RelayHealth`, `Inspector` and the key codecs.

Kind numbers are in the [kind index](./docs/README.md#kind-index).

## Rules

- No React, no DOM, no storage of its own. You supply `LinkstrIdentity`, `NostrTransport`, `RelayPolicy` and the `OutboxStore` / `InboxCursorStore` ports.
- A private send publishes the same rumor wrapped to you and to the peer. It succeeds only when a relay accepted the peer's copy; "only my copy landed" is the `RecipientNotReached` error.
- `NostrTransport.publish` reports per-relay outcomes and never retries. Retry and backoff live in the `Outbox`.
- Every inbound gift wrap is verified: both signatures, the author match between rumor and seal, the rumor hash. Anything that fails arrives as a `WrapDropped` fact with a typed reason.
- Every failure is a `Schema.TaggedError`, so it can be persisted without ad-hoc stringification.

## Documentation

Guides are in [`docs/`](./docs/README.md); start with [getting started](./docs/getting-started.md).
