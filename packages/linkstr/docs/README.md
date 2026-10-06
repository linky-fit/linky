# @linky-fit/linkstr guides

Guides for the package and its React binding `@linky-fit/linkstr-react`. The exported types are the reference; the guides say what to call, in which order, and what each call guarantees. Design rules are in the [package README](../README.md).

## Reading order

1. [Getting started](./getting-started.md): install, what you bring, `runLinkstr` vs `linkstrServices`, a first send and receive.
2. [Concepts](./concepts.md): drafts, receipts and facts, honest delivery, wire conventions, the error table.
3. [Inbox](./inbox.md): the one kind-1059 subscription, its event union, cursor, drop reasons and one-shot fetch.
4. The guide for the vertical you need.
5. [React](./react.md) if you are in a React app.

## Guides

Gift-wrapped (private, kind 1059 on the wire):

- [Chat](./chat.md): text, file and cashu-token messages, edits
- [Reactions](./reactions.md): emoji reactions and retractions
- [Seen receipts](./seen-receipts.md): read-receipt window cursors
- [Payment kinds](./payment-kinds.md): payment notices, payment telemetry, bank offers
- [App messages](./app-messages.md): your app's own typed messages

Plain (public, signed and published unwrapped):

- [Plain events](./plain-events.md): profiles and status, relay lists, mute list, NIP-78 app data
- [Nostr Connect login](./nostr-connect.md): one NIP-46 `nostrconnect://` login as the remote signer

Never published:

- [HTTP auth](./http-auth.md): signed events as HTTP credentials for Blossom, NIP-98 and push ownership proofs

Machinery:

- [Outbox](./outbox.md): the durable send queue
- [Identity and keys](./identity-and-keys.md): key codecs and the identity service
- [Push inbox](./push-inbox.md): identity-free wrap routing for a push server
- [Diagnostics](./diagnostics.md): relay health and the inspector
- [Testing](./testing.md): stubs, fakes and example tests for both packages

## Kind index

Every event kind the package produces. Wrapped kinds travel inside a kind 1059 gift wrap; "push" says whether the recipient copy carries the `["linky", "push"]` marker. 24133 appears twice: the payment-notice rumor only ever travels inside a gift wrap, the plain NIP-46 event never does, so the two never collide.

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
| 24137 | app message                               | yes     | no                  | [app-messages.md](./app-messages.md#wire-format)         |
| 0     | profile metadata                          | no      | n/a                 | [plain-events.md](./plain-events.md#profiles-and-status) |
| 30315 | status                                    | no      | n/a                 | [plain-events.md](./plain-events.md#profiles-and-status) |
| 10000 | mute list                                 | no      | n/a                 | [plain-events.md](./plain-events.md#mute-list)           |
| 10002 | relay list                                | no      | n/a                 | [plain-events.md](./plain-events.md#relay-lists)         |
| 10050 | DM relay list                             | no      | n/a                 | [plain-events.md](./plain-events.md#relay-lists)         |
| 30078 | app data (NIP-78)                         | no      | n/a                 | [plain-events.md](./plain-events.md#app-data-nip-78)     |
| 24133 | NIP-46 Nostr Connect message (ephemeral)  | no      | n/a                 | [nostr-connect.md](./nostr-connect.md#wire-format)       |
| 24242 | Blossom upload auth (never published)     | no      | n/a                 | [http-auth.md](./http-auth.md#wire-format)               |
| 27235 | NIP-98 auth, push proof (never published) | no      | n/a                 | [http-auth.md](./http-auth.md#wire-format)               |

Tag order, content schemas and the conventions shared by all kinds are in [Concepts, wire conventions](./concepts.md#wire-conventions).
