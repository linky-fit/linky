# @linky-fit/linkstr guides

How to use the package and its React binding `@linky-fit/linkstr-react`. These are guides, not an API reference: the exported types are the reference, and the [package README](../README.md) states the design rules.

## Reading order

1. [Getting started](./getting-started.md) — install, what you bring, `runLinkstr` vs `linkstrServices`, a first send and receive.
2. [Concepts](./concepts.md) — vocabulary, drafts/receipts/facts, honest delivery, wire conventions, branded primitives, the error table every other guide links to.
3. [Inbox](./inbox.md) — the one kind-1059 subscription: the event union, cursor, dedupe, drop reasons, one-shot fetch.
4. The guide for the vertical you need. Each opens with a working call, states the wire format, lists its inbound facts and names the errors it adds to the shared table.
5. [React](./react.md) if you are in a React app.

## Guides

Gift-wrapped (private, kind 1059 on the wire):

- [Chat](./chat.md) — text, file and cashu-token messages, edits
- [Reactions](./reactions.md) — emoji reactions and retractions
- [Seen receipts](./seen-receipts.md) — read-receipt window cursors
- [Payment kinds](./payment-kinds.md) — payment notices, payment telemetry, bank offers

Plain (public, signed and published unwrapped):

- [Plain events](./plain-events.md) — profiles and status, relay lists, mute list

Never published:

- [HTTP auth](./http-auth.md) — signed events as HTTP credentials: Blossom, NIP-98, push ownership proofs

Machinery:

- [Outbox](./outbox.md) — the durable send queue
- [Identity and keys](./identity-and-keys.md) — key codecs and the identity service
- [Push inbox](./push-inbox.md) — identity-free wrap routing for a push server
- [Diagnostics](./diagnostics.md) — relay health and the inspector
- [Testing](./testing.md) — stubs, fakes and example tests for both packages

## Kind index

Every event kind the package produces. Wrapped kinds travel inside a kind 1059 gift wrap; "push" says whether the recipient copy carries the `["linky", "push"]` marker.

| Kind  | What                                      | Wrapped | Push                | Guide                                                    |
| ----- | ----------------------------------------- | ------- | ------------------- | -------------------------------------------------------- |
| 14    | chat text, cashu token, edit              | yes     | text yes, others no | [chat.md](./chat.md#wire-format)                         |
| 15    | chat image or PDF                         | yes     | yes                 | [chat.md](./chat.md#wire-format)                         |
| 7     | reaction                                  | yes     | no                  | [reactions.md](./reactions.md#wire-format)               |
| 5     | reaction retraction                       | yes     | no                  | [reactions.md](./reactions.md#wire-format)               |
| 24133 | payment notice                            | yes     | yes                 | [payment-kinds.md](./payment-kinds.md#payment-notices)   |
| 24134 | payment telemetry                         | yes     | no                  | [payment-kinds.md](./payment-kinds.md#payment-telemetry) |
| 24135 | bank payment offer snapshot               | yes     | per status          | [payment-kinds.md](./payment-kinds.md#bank-offers)       |
| 24136 | seen receipt                              | yes     | no                  | [seen-receipts.md](./seen-receipts.md#wire-format)       |
| 0     | profile metadata                          | no      | —                   | [plain-events.md](./plain-events.md#profiles-and-status) |
| 30315 | status                                    | no      | —                   | [plain-events.md](./plain-events.md#profiles-and-status) |
| 10000 | mute list                                 | no      | —                   | [plain-events.md](./plain-events.md#mute-list)           |
| 10002 | relay list                                | no      | —                   | [plain-events.md](./plain-events.md#relay-lists)         |
| 10050 | DM relay list                             | no      | —                   | [plain-events.md](./plain-events.md#relay-lists)         |
| 24242 | Blossom upload auth (never published)     | no      | —                   | [http-auth.md](./http-auth.md#wire-format)               |
| 27235 | NIP-98 auth, push proof (never published) | no      | —                   | [http-auth.md](./http-auth.md#wire-format)               |

Tag order, content schemas and the conventions shared by all kinds (`p` order, `client`, `linky` markers, delivery order) are in [Concepts → Wire conventions](./concepts.md#wire-conventions).
