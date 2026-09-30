# @linky-fit/linkstr

Typed Nostr messaging, profiles and relay services, built on Effect. Every operation is an Effect service that takes a draft and returns a receipt; everything inbound arrives on one stream as a tagged union of facts. Raw Nostr events never cross the package boundary, so consumers never import `nostr-tools`.

## Install

```bash
bun add @linky-fit/linkstr effect
```

ESM with TypeScript declarations, for Node 22.14+ and modern browser bundlers. The `@linky-fit/linkstr/testing` subpath needs Vitest 4 as an optional peer; the main entry does not.

## What is in the box

- **Gift-wrapped verticals** (NIP-17/NIP-59, kind 1059 on the wire): `Chat` (kinds 14/15), `Reactions` (7/5), `SeenReceipts` (24136), `PaymentNotices` (24133), `PaymentTelemetry` (24134), `BankOffers` (24135).
- **Plain events** (signed, published as-is): `Profiles` and `ProfileWatch` (kinds 0/30315), `RelayLists` (10002/10050), `MuteList` (10000).
- **HTTP auth codecs**: Blossom upload auth (24242), NIP-98 headers and push ownership proofs (27235). Signed, never published.
- **Shared machinery**: `WrapInbox` (the one kind-1059 subscription, plus one-shot `fetchWrapEvent`), `Outbox` (durable send queue with retries), `PushInbox` (identity-free wrap routing for push servers), `RelayHealth`, `Inspector`, and the key codecs (`decodeNsec`, `parsePubkey`, …).

## Rules

- **Environment-agnostic.** No React, no DOM, no storage of its own. Capabilities enter as services: `LinkstrIdentity`, `NostrTransport`, `RelayPolicy`, and the `OutboxStore` / `InboxCursorStore` ports.
- **Honest delivery.** A private send publishes the same rumor wrapped to you and to the peer. It succeeds only when a relay accepted the _peer's_ copy; "only my copy landed" is the `RecipientNotReached` error, never a silent success.
- **No hidden retries in the transport.** `NostrTransport.publish` reports per-relay outcomes; retry and backoff live in the `Outbox`.
- **Authenticated inbound.** Every gift wrap is unwrapped by hand: outer and seal signatures must verify, the rumor author must equal the seal author and differ from the ephemeral wrap key, and the rumor id must be the rumor's hash. Anything else is a `WrapDropped` fact with a typed reason.
- **Serializable errors.** Every failure is a `Schema.TaggedError`, so it can be persisted (the outbox stores them on job rows) without ad-hoc stringification.

## Documentation

The guides in [`docs/`](./docs/README.md) are the manual. Start with [getting started](./docs/getting-started.md) (configuration, `runLinkstr` vs `linkstrServices`, a first send and receive), keep [concepts](./docs/concepts.md) open for vocabulary, wire conventions and the error table, then read the guide for the vertical you need.
