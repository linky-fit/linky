# @linky/linkstr guides

How to use Linky's Nostr protocol library and its React binding `@linky/linkstr-react`. These are guides, not an API reference: the exported types are the reference, and the [package README](../README.md) holds the design rules and rationale.

## Where to start

1. [Getting started](./getting-started.md) — configure your key and relays, run one send and one receive, and learn the core concepts in one page. Read this first.
2. [React](./react.md) if you are working in the web app: the config atom, the runtime, and the atom for each operation.
3. The guide for the vertical you need, from the list below. Each one opens with a working example; jump to its Errors section when a send fails.

[Concepts](./concepts.md) is the lookup behind all of them: drafts, receipts, and facts; gift-wrapped vs plain kinds; honest delivery; branded primitives; a short Effect primer.

## Verticals

Gift-wrapped (private, kind 1059 on the wire):

- [Chat](./chat.md) — text, image, and Cashu-token messages plus edits
- [Reactions](./reactions.md) — emoji reactions and retractions; the reference vertical
- [Seen receipts](./seen-receipts.md) — read-receipt window cursors
- [Payment notices](./payment-notices.md) — "you were paid" pings
- [Payment telemetry](./payment-telemetry.md) — anonymous payment outcome reports
- [Bank offers](./bank-offers.md) — proxy bank-payment offers

Plain (public, signed and published unwrapped):

- [Profiles](./profiles.md) — metadata and status, publish, fetch, search, and watch
- [Relay lists](./relay-lists.md) — read and inbox relay lists as one operation
- [Mute list](./mute-list.md) — the mute list

Never published:

- [HTTP auth](./http-auth.md) — signed events as HTTP credentials for Blossom, the push server, and NIP-98

## Receiving, retries, and diagnostics

- [Inbox](./inbox.md) — the single gift-wrap subscription, the event union, cursors, and one-shot fetch
- [Outbox](./outbox.md) — the durable send queue with retry and backoff
- [Identity and keys](./identity-and-keys.md) — key codecs and the identity service
- [Push inbox](./push-inbox.md) — identity-free wrap routing for the push server
- [Relay health](./relay-health.md) — per-relay status derived from traffic
- [Inspector](./inspector.md) — diagnostics events and how to consume them

## Working on the package

- [Testing](./testing.md) — fakes and stubs for both packages, with full example tests
- [Adding a vertical](./adding-a-vertical.md) — the four files, the registration points, and the tests to write

## Finding your way

- Looking for a type or method name? Open `src/index.ts` and follow the export; every guide names the file it documents.
- Wondering what arrives on the wire? Each vertical guide states its kinds and whether it is gift-wrapped; [Inbox](./inbox.md) lists every inbound event tag in one table.
- A send failed? The vertical guide's errors table says what each failure means; [Concepts](./concepts.md#honest-delivery) explains why "only my copy landed" is a failure.
- Want a working consumer to copy from? The web app hooks named in [React](./react.md), the service worker for `runLinkstr`, and `apps/push` for the push inbox.
