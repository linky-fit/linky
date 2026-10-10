# Concepts

The words every linkstr API uses, what goes in and comes out, how delivery is judged, and what every failure means.

## Vocabulary

| Term                      | Meaning                                                                                                                                                                                                     |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rumor                     | The inner, unsigned Nostr event that carries the content (a message, a reaction). Its id, `RumorId`, is the stable identity of the thing sent.                                                              |
| Gift wrap                 | The encrypted, signed envelope (kind 1059) a rumor travels in, so relays see only ciphertext and a recipient tag. A fresh wrap is generated on every publish, so `WrapId` is transport-level identity only. |
| Self copy, recipient copy | A private send wraps the same rumor twice: once addressed to you, once to the peer.                                                                                                                         |
| Own echo                  | Your self copy coming back from a relay, or a send from another of your devices, surfaced as an `Own…Confirmed` fact. It is your reconciliation signal, never an incoming message.                          |
| EOSE                      | "End of stored events": the marker a relay sends once it has replayed everything it stored for your subscription. Events before it are `backfill`, events after it `live`.                                  |
| Plain event               | A signed Nostr event published as-is (profile, relay lists, mute list). Anyone can read it.                                                                                                                 |

## Drafts in, receipts out, facts back

A **draft** (`TextMessageDraft`, `ReactionDraft`, …) goes in; it is a `Schema.Class`, built with `new TextMessageDraft({ … })`. Optional `clientId` and `sentAt` are filled in when omitted; pass `clientId` when you already inserted an optimistic local row so the relay echo can be matched back.

A **receipt** (`ChatMessageReceipt`, `ReactionReceipt`, …) comes back; it is a `Schema.TaggedClass`, and every wrap receipt names the delivered rumor as `rumorId`, so you never switch on the receipt class to find the id.

**Facts** (`ChatMessageReceived`, `ReactionAdded`, …) arrive through `WrapInbox` as one tagged union, `WrapInboxEvent`. A two-copy vertical contributes a peer-authored fact and an own echo (`ChatMessageReceived` vs `OwnChatMessageConfirmed`). Dispatch on `_tag` ([inbox.md](./inbox.md)).

Not every vertical has all three shapes: payment notices are single-copy (a peer fact, no own echo); payment telemetry is single-copy with no inbox fact at all, so a telemetry wrap addressed to you surfaces as `WrapDropped("unsupported-kind")`; the plain verticals (profiles, relay lists, mute list) are fetched or watched rather than received through the inbox ([payment-kinds.md](./payment-kinds.md), [plain-events.md](./plain-events.md)). The [kind index](./README.md#kind-index) lists which kinds are wrapped, plain, or never published.

## Honest delivery

A private send wraps the same rumor twice, once to yourself (cross-device echo) and once to the peer, and publishes both to every write relay. The receipt carries both as `selfCopy` and `recipientCopy` (`WrapDelivery`: `wrapId`, `acceptedBy`, `rejectedBy`, `accepted`).

| Outcome                                     | Result                 |
| ------------------------------------------- | ---------------------- |
| ≥1 relay accepted the recipient copy        | receipt                |
| self copy accepted, recipient copy rejected | `RecipientNotReached`  |
| nothing accepted                            | `NoRelayReachable`     |
| single-copy send, nothing accepted          | `WrapNotDelivered`     |
| plain event, nothing accepted               | `NoRelayAcceptedEvent` |

"Only my self copy landed" is never reported as success. A relay accepting the copy is not the peer reading it; the peer's client still has to receive and decode it. The transport never retries; when you need retries, use the [outbox](./outbox.md).

## Wire conventions

Each vertical guide has a **Wire format** section: kind, tags in order, content, delivery. These rules are shared by all of them.

- **Layering.** A private send is a rumor (unsigned, kind-specific) inside a seal (kind 13, signed by the sender) inside a gift wrap (kind 1059, signed by a throwaway key, with `["p", recipient]` as its routing tag). Seal and wrap use NIP-44 v2. The wrap's `created_at` is randomized up to two days into the past; the rumor's is the real send time.
- **Rumor id.** The NIP-01 hash of the unsigned rumor. Both copies of a send carry the same rumor, so they share one id, and the outbox retries the stored rumor, so the id survives retries.
- **`p` tag order.** A directed rumor tags the recipient first and the author second. Decoders find the peer by position relative to the reader, so the order is part of the format.
- **`["client", <ClientId>]`.** An idempotency key that exists before the rumor does and comes back on own echoes, so an optimistic row can be matched. It shares the tag name with NIP-89's `client` tag.
- **`["linky", <value>]`.** Inside a rumor it names a Linky-specific kind (`payment_notice`, `payment_telemetry`, `bank_payment_offer`, `seen_receipt`) and the decoder requires it. On a wrap, `["linky", "push"]` is the plaintext push marker ([push-inbox.md](./push-inbox.md)), set only on a recipient copy; it is a deliberate, minimal metadata leak.
- **Delivery order.** A two-copy send publishes both wraps to every write relay in parallel; token messages and bank offers publish the recipient copy first and attempt the self copy only after a relay accepted it, except `bank_details_sent`, which publishes the self copy first and the recipient copy only after a relay accepted it.
- **Kind numbers.** Linky-invented kinds are 24133–24139; each carries its own `["linky", <value>]` marker and a row in the [kind index](./README.md#kind-index).

## Branded primitives

Each is an effect `Schema` with a brand, so a plain `string` does not type-check where a `Pubkey` is expected.

| Type             | Shape                                         | Make one                                                                |
| ---------------- | --------------------------------------------- | ----------------------------------------------------------------------- |
| `Pubkey`         | 64 hex, on the curve                          | `parsePubkey(str)`, `decodeNpub(str)`, `derivePubkey(key)`              |
| `NostrSecretKey` | 32 bytes a public key derives from            | `decodeNsec(str)`                                                       |
| `RumorId`        | 64 hex; identity of a message                 | from receipts and facts                                                 |
| `WrapId`         | 64 hex; one signed wrap                       | from `WrapDelivery.wrapId`, push payloads                               |
| `EventId`        | 64 hex; one signed plain event                | from `PlainEventReceipt.eventId`                                        |
| `ClientId`       | non-empty trimmed string                      | `ClientId.make(localId)`                                                |
| `RelayUrl`       | `wss://` url, or loopback `ws://` (see below) | `RelayUrl.make(str)` (throws) or `Schema.decodeUnknownOption(RelayUrl)` |
| `UnixSeconds`    | positive integer                              | `UnixSeconds.make(n)`                                                   |
| `Emoji`          | trimmed, 1–32 chars                           | `Emoji.make(str)`                                                       |

`X.make(value)` validates and throws on failure; `Schema.is(X)` is a type guard; `Schema.decodeUnknownOption(X)` returns an `Option`. `Pubkey` and `NostrSecretKey` are validated cryptographically, not just by length, so revalidate stored strings with `Schema.is(Pubkey)` at the boundary rather than inside a send.

`RelayUrl` accepts `wss://` urls with a host and without credentials or fragment, plus `ws://localhost`, `ws://127.0.0.1` and `ws://[::1]` for local development. Other `ws://` hosts are rejected. The default transport still refuses a loopback `ws://` url unless it was built with `allowInsecureLocalhost: true` (`runLinkstr` config, `makeNostrTransportSimplePool(options)`, `LinkstrConfig` in React, `watchPushInbox` config). `DEFAULT_NOSTR_RELAYS` is a plain string array; filter it through `Schema.is(RelayUrl)` before handing it to a config.

## Services and layers

Capabilities enter as Effect services and the composition root supplies them:

| Service            | Provides                        | Layer                                             |
| ------------------ | ------------------------------- | ------------------------------------------------- |
| `LinkstrIdentity`  | `pubkey`, `secretKey`           | `LinkstrIdentity.fromSecretKey(key)`              |
| `RelayPolicy`      | `readRelays`, `writeRelays`     | `RelayPolicy.fixed({ readRelays, writeRelays })`  |
| `NostrTransport`   | `publish`, `subscribe`, `fetch` | `NostrTransportSimplePool` or a stub              |
| `OutboxStore`      | durable job list                | `OutboxStore.inMemory`, `.fromStringStorage`      |
| `InboxCursorStore` | persisted backfill cursor       | `InboxCursorStore.inMemory`, `.fromStringStorage` |
| `Inspector`        | optional diagnostics bus        | `Inspector.live`, `.disabled`, or none            |
| `RelayHealth`      | per-relay connection snapshot   | `RelayHealth.live`                                |

Vertical services (`Chat`, `Reactions`, `WrapInbox`, …) are `Effect.Service` classes with a `.Default` layer. `linkstrServices(config)` assembles all of them; `runLinkstr` and the React runtime both call it ([getting-started.md](./getting-started.md#two-ways-to-run)). You only build layers by hand in tests.

You need little Effect to use the package: `yield*` a service tag inside `Effect.gen` and call a method; handle failures with `Effect.catchTags` or `Effect.either` before the Promise boundary (`Effect.runPromise` rejects with a wrapped cause, not the tagged error); consume a `Stream` with `Stream.runForEach`; run anything that requires `Scope` (like `inbox.open`) inside `Effect.scoped`.

## Errors

Every failure is a `Schema.TaggedError`: match on `_tag`, persist it as-is when you need to. This is the complete set; vertical guides only say which of these they produce.

| Tag                               | Produced by                                                       | Meaning                                                                                         | What to do                                                           |
| --------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `RecipientNotReached`             | two-copy sends                                                    | your self copy landed, no relay accepted the peer's copy                                        | the peer will not see it; retry (the outbox does this for you)       |
| `NoRelayReachable`                | two-copy sends                                                    | no relay accepted either wrap (or, for sequential sends, the copy published first)              | offline or all write relays down; retry later                        |
| `WrapNotDelivered`                | single-copy sends (`PaymentNotices`, `PaymentTelemetry`)          | no relay accepted the only wrap                                                                 | retry later                                                          |
| `NoRelayAcceptedEvent`            | plain publishes (`Profiles`, `RelayLists`, `MuteList`)            | no write relay accepted the event; `results` lists each relay                                   | retry; the previous event stays on relays                            |
| `AllRelaysUnreachable`            | one-shot fetches (`fetchWrapEvent`, profile and relay/mute lists) | no relay answered at all; `failures` lists them                                                 | keep cached data, retry later                                        |
| `SomeRelaysUnanswered`            | mute-list fetch                                                   | no answering relay holds a list and `failures` did not answer                                   | keep the local list, publish nothing, retry later                    |
| `NoReadRelaysConfigured`          | `WrapInbox.open`, `ProfileWatch.watch`, every fetch               | `RelayPolicy.readRelays` is empty (mute-list fetch: read and write relays)                      | configure relays first                                               |
| `RelayUnreachable`                | `NostrTransport.subscribe` / `fetch`                              | one relay could not be reached; `detail` is the reason                                          | only seen when calling the transport directly                        |
| `NostrConnectAckNotDelivered`     | `NostrConnect.login`                                              | no relay accepted the connect ack or a reply; `results` lists each relay                        | the site is not logged in; check the connection, rescan a fresh link |
| `NostrConnectRelaysUnreachable`   | `NostrConnect.login`, `NostrConnectClient.open` and its session   | no request subscription on the link's relays opened or stayed open; `failures` lists each relay | the site is not logged in; check the connection, rescan a fresh link |
| `NostrConnectRequestRefused`      | `NostrConnect.login`                                              | the site asked to sign something the login policy forbids; `method`, `reason`                   | the site is not logged in; do not retry automatically                |
| `NostrConnectTimedOut`            | `NostrConnect.login`                                              | the site answered nothing within the login window                                               | rescan a fresh link                                                  |
| `NostrConnectSignerTimedOut`      | `NostrConnectClient` session                                      | the signer did not connect (`waitingFor: "connect"`) or reply (`"reply"`) in time               | open a fresh session and show its new link                           |
| `NostrConnectSignRefused`         | `NostrConnectClient` session                                      | the signer answered with an error, or with an event other than the template; `reason`           | show `reason`; do not retry automatically                            |
| `NostrConnectRequestNotDelivered` | `NostrConnectClient` session                                      | no relay accepted a request to the signer; `results` lists each relay                           | check the connection; open a fresh session                           |
| `LinkstrNotConfigured`            | every `@linky-fit/linkstr-react` fn atom                          | `linkstrConfigAtom` is `null` (logged out)                                                      | do not send; read from cache                                         |

The delivery errors (`RecipientNotReached`, `NoRelayReachable`, `WrapNotDelivered`) carry `rumorId`, `clientId`, `sentAt` and the `WrapDelivery` copies that were attempted. A relay answers a one-shot fetch when it sends EOSE or at least one event; one that stays silent past the EOSE timeout (5 s) or closes the subscription first counts as unanswered, so an empty result always means an answering relay holds nothing. A one-shot fetch that reached some relays but not others succeeds with what arrived, except a mute-list fetch that found no list (`SomeRelaysUnanswered`). `OutboxJobFailed` is not an error but a result on the outbox stream ([outbox.md](./outbox.md#results)).
