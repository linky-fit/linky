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

## Kind index

Every event kind linkstr produces. Wrapped kinds travel inside a kind 1059 gift wrap; "push" says whether the recipient copy carries the `["linky", "push"]` marker.

| Kind  | What                                      | Wrapped | Push                | Guide                                                      |
| ----- | ----------------------------------------- | ------- | ------------------- | ---------------------------------------------------------- |
| 14    | chat text, cashu token, edit              | yes     | text yes, others no | [chat.md](./chat.md#wire-format)                           |
| 15    | chat image or PDF                         | yes     | yes                 | [chat.md](./chat.md#wire-format)                           |
| 7     | reaction                                  | yes     | no                  | [reactions.md](./reactions.md#wire-format)                 |
| 5     | reaction retraction                       | yes     | no                  | [reactions.md](./reactions.md#wire-format)                 |
| 24133 | payment notice                            | yes     | yes                 | [payment-notices.md](./payment-notices.md#wire-format)     |
| 24134 | payment telemetry                         | yes     | no                  | [payment-telemetry.md](./payment-telemetry.md#wire-format) |
| 24135 | bank payment offer snapshot               | yes     | per status          | [bank-offers.md](./bank-offers.md#wire-format)             |
| 24136 | seen receipt                              | yes     | no                  | [seen-receipts.md](./seen-receipts.md#wire-format)         |
| 0     | profile metadata                          | no      | —                   | [profiles.md](./profiles.md#wire-format)                   |
| 30315 | status                                    | no      | —                   | [profiles.md](./profiles.md#wire-format)                   |
| 10000 | mute list                                 | no      | —                   | [mute-list.md](./mute-list.md#wire-format)                 |
| 10002 | relay list                                | no      | —                   | [relay-lists.md](./relay-lists.md#wire-format)             |
| 10050 | DM relay list                             | no      | —                   | [relay-lists.md](./relay-lists.md#wire-format)             |
| 24242 | Blossom upload auth (never published)     | no      | —                   | [http-auth.md](./http-auth.md#wire-format)                 |
| 27235 | NIP-98 auth, push proof (never published) | no      | —                   | [http-auth.md](./http-auth.md#wire-format)                 |

Tag order, content schemas, and the conventions shared by all kinds (`p` order, `client`, `linky` markers, delivery) are in [Concepts → Wire conventions](./concepts.md#wire-conventions).

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
- Wondering what arrives on the wire? The [kind index](#kind-index) above, each guide's Wire format section, and [Inbox](./inbox.md) for every inbound event tag in one table.
- A send failed? The vertical guide's errors table says what each failure means; [Concepts](./concepts.md#honest-delivery) explains why "only my copy landed" is a failure.
- Want a working consumer to copy from? The web app hooks named in [React](./react.md), the service worker for `runLinkstr`, and `apps/push` for the push inbox.
