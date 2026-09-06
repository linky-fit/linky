# @linky/linkstr

Linky's Nostr protocol as a typed library. Every operation the app publishes
(send a chat message, react, pay, update profile/status, …) and every inbound
action it expects are defined here as Effect `Schema` types. Raw nostr events
never cross the package boundary: callers hand in drafts and get receipts;
listeners consume a tagged union of app-level facts.

## Verticals

Gift-wrapped (NIP-17/NIP-59, kind 1059 on the wire):

- `chat/` — text, image, and Cashu-token messages plus edits (kinds 14/15)
- `reactions/` — kind 7 + kind 5 retractions; the reference vertical
- `paymentNotices/` — kind 24133
- `paymentTelemetry/` — kind 24134
- `bankOffers/` — kind 24135

Plain events (signed, published unwrapped):

- `profiles/` — kind 0 metadata + kind 30315 status; `ProfileWatch` is the
  long-lived subscription counterpart
- `relayLists/` — kinds 10002 + 10050, published as one operation
- `muteList/` — kind 10000

HTTP auth (`httpAuth/`) — pure codecs for signed events used as HTTP
credentials, never published to relays: Blossom upload auth (kind 24242),
push-server ownership proofs, and NIP-98 `Authorization` headers (kind 27235).

Key codecs (`identity/codec.ts`) — pure nip19/derivation helpers returning the
branded types (`decodeNsec`, `parsePubkey`, `identityFromNsec`, …), so
consumers never import `nostr-tools` even for key encoding. `parsePubkey` and
friends enforce the `Pubkey` brand's on-curve check at parse time.

Shared machinery: `inbox/WrapInbox` (the single kind-1059 subscription),
`push/PushInbox` (identity-free outer-wrap routing for push infrastructure),
`outbox/Outbox` (durable send queue with retry/backoff over a pluggable
`OutboxStore`), `relayHealth/` (traffic-derived per-relay status, always on),
and `inspector/` (optional dev diagnostics bus).

## Shape of a vertical

- `reactions/domain.ts` — drafts and receipts (`ReactionDraft`, `ReactionReceipt`)
- `reactions/events.ts` — inbound facts (`ReactionAdded`, `OwnReactionConfirmed`,
  `ReactionRetracted`) plus `WrapDropped` with a typed reason
- `reactions/codec.ts` — the only place the wire format (kinds, tags) exists;
  encode and decode roundtrip by construction
- `reactions/Reactions.ts` — the operation service (`react`, `retract`)
- `inbox/decodeWrapEvent.ts` — pure pipeline for one incoming kind-1059 wrap,
  routing the decoded rumor to the owning vertical's codec

## Inbound subscription

`WrapInbox` owns the single kind-1059 subscription. `inbox.open({ since })` is
a scoped resource: it subscribes on every `RelayPolicy.readRelays` entry with
its own resubscribe loop and returns a single-consumer `Stream` of typed inbox
facts (`ReactionAdded`, `ChatMessageReceived`, `WrapDropped`, …). The backfill
cursor is loaded from and checkpointed to the `InboxCursorStore` port
(platform code supplies the layer, e.g. `fromStringStorage(localStorage, key)`;
the default is in-memory); `since` only seeds a first session whose store is
empty, and the machine widens the cursor by the NIP-59 two-day backdate margin
itself. Rumor kinds without a vertical surface as
`WrapDropped("unsupported-kind")` — the dispatch point in `WrapInbox` is where
future verticals plug in. Closing the scope tears down all relay
subscriptions and ends the stream.

`PushInbox` is the non-decrypting sibling for the push server. Each relay
subscription uses only `kinds: [1059]` plus `since`; the codec enforces the
`["linky", "push"]` marker client-side because multi-letter tag filters are
nonstandard. It verifies outer signatures, extracts the one recipient and
relay hints, marks each delivery as backfill or live, dedupes live emissions
across relays, and re-emits every backfill copy. `watchPushInbox` supplies the
long-lived Promise-facing composition without requiring a `LinkstrIdentity`.

`inbox.fetchWrapEvent(wrapId, { extraRelays })` is the one-shot counterpart
for notification opens. It unions relay hints with configured read relays and
returns the same decoded `WrapInboxEvent`, or `null` when no matching wrap is
found, without adding subscription delivery metadata.

## Rules

- **Environment-agnostic.** No React, no Evolu, no `window`. Capabilities come
  in as services: `LinkstrIdentity`, `NostrTransport`, `RelayPolicy`.
- **Honest delivery.** A NIP-17 send publishes the same rumor wrapped to self
  and to the peer. Success means the _recipient's_ copy was accepted by at
  least one relay; "only my self copy landed" is the `RecipientNotReached`
  error, never a silent success.
- **No hidden retries in the transport.** `NostrTransport.publish` reports
  per-relay outcomes; retry/backoff policy lives in the `Outbox`.
- **Authenticated inbound.** Incoming wraps are unwrapped by hand, not with
  nostr-tools' `unwrapEvent` (which verifies nothing): the seal signature must
  verify, the rumor author must equal the seal author (and not the ephemeral
  wrap key), and the rumor id must be the hash of the rumor. Anything else is
  a `WrapDropped` with a typed reason.
- **Serializable errors.** All errors are `Schema.TaggedError`, so failures can
  be persisted (e.g. on outbox rows) without ad-hoc stringification.

## Usage

Service assembly has one home: `linkstrServices(config)` layers every vertical
over the base services. React apps should use `@linky/linkstr-react` (config +
runtime atoms, fn atoms per vertical) instead of wiring layers themselves.
Non-React environments (the service worker) use the headless one-shot runner:

```ts
import { Effect } from "effect";
import { Reactions, runLinkstr } from "@linky/linkstr";

const receipt = await runLinkstr(
  { secretKey, readRelays, writeRelays },
  Effect.gen(function* () {
    const reactions = yield* Reactions;
    return yield* reactions.react(draft); // ReactionReceipt | RecipientNotReached | NoRelayReachable
  }),
);
```
