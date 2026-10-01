# Inbox

`WrapInbox` is the one kind-1059 subscription: it backfills from a persisted cursor, authenticates every gift wrap, and hands you typed facts on a single stream. It is also the one-shot decoder for a wrap a push notification names. Rumor, own echo and EOSE are defined in [concepts.md](./concepts.md#vocabulary); in React the same feed runs behind `wrapInboxAtom` ([react.md](./react.md#inbox)).

## Open the feed

```ts
import { Effect, Stream } from "effect";
import { UnixSeconds, WrapInbox } from "@linky-fit/linkstr";

/** Backfill window for a first session without a stored cursor. */
const LOOKBACK_SECONDS = 3 * 24 * 60 * 60;

const consume = Effect.scoped(
  Effect.gen(function* () {
    const inbox = yield* WrapInbox;
    const feed = yield* inbox.open({
      since: UnixSeconds.make(Math.floor(Date.now() / 1000) - LOOKBACK_SECONDS),
    });
    yield* Stream.runForEach(feed.events, ({ delivery, event }) =>
      Effect.sync(() => console.log(delivery, event)),
    );
  }),
);
```

- `open(options?)` returns `WrapInboxFeed` and requires a `Scope`. Leaving the scope closes every relay subscription and ends the stream.
- Options: `since` (backfill start, used only when the cursor store is empty) and `resubscribeDelay` (base of the per-relay reconnect backoff, default 5 s).
- Fails with `NoReadRelaysConfigured` when `RelayPolicy.readRelays` is empty.
- `feed.events` is `Stream<DeliveredInboxEvent>`: `{ delivery, event }`. It is **single-consumer**; if two parts of your app need it, consume once and fan out.
- `delivery` is `"backfill"` until the delivering relay sends EOSE, then `"live"`. Interrupt the user (toast, notification) for live events only. After a reconnect the relay replays its window, so those arrivals are backfill again.
- Each read relay runs its own subscription and reconnect loop (exponential backoff with jitter from `resubscribeDelay`, capped at 12×), so one dead relay never stalls the others.

## The event union

`event` is a `WrapInboxEvent`. Dispatch on `_tag`:

| Vertical        | Peer-authored fact                   | Own echo                                         |
| --------------- | ------------------------------------ | ------------------------------------------------ |
| Chat            | `ChatMessageReceived`                | `OwnChatMessageConfirmed`                        |
| Reactions       | `ReactionAdded`, `ReactionRetracted` | `OwnReactionConfirmed`, `OwnRetractionConfirmed` |
| Payment notices | `PaymentNoticeReceived`              | none                                             |
| Bank offers     | `BankOfferSnapshotReceived`          | `OwnBankOfferSnapshotConfirmed`                  |
| Seen receipts   | `SeenReceiptReceived`                | `OwnSeenReceiptConfirmed`                        |
| (any)           | `WrapDropped`                        |                                                  |

Peer facts carry `from`; own echoes carry `to` (the peer) and a nullable `clientId` so you can reconcile an optimistic local row. A `switch (event._tag)` or effect's `Match.tag` dispatches; `Match.tagsExhaustive` makes the compiler demand a branch per tag. Run one consumer per process and hand each vertical's tags to its own handler (each vertical guide has one).

## Authentication and drop reasons

Before a wrap becomes a fact its outer signature is verified, it is decrypted, the seal signature is verified, the rumor author must equal the seal author and differ from the ephemeral wrap key, the rumor id must equal the rumor's hash, and a rumor timestamp more than five minutes in the future is rejected (there is no age cutoff; wrap timestamps are randomized by NIP-59 and never checked). Anything that fails surfaces as `WrapDropped` with `wrapId` (null when the outer event was malformed) and a `reason`:

| Reason                                                                                | Meaning                                                                             |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `malformed-wrap`                                                                      | not a valid signed kind-1059 event                                                  |
| `not-addressed-to-me`                                                                 | no `p` tag with your pubkey (also a seen receipt from a peer that does not tag you) |
| `invalid-wrap`                                                                        | outer signature verification failed                                                 |
| `unwrap-failed`                                                                       | decryption failed                                                                   |
| `invalid-seal`                                                                        | seal does not decode or its signature fails                                         |
| `malformed-rumor`, `forged-rumor-id`                                                  | rumor does not decode, or its id ≠ its hash                                         |
| `invalid-rumor-timestamp`                                                             | rumor timestamp more than five minutes in the future                                |
| `sender-forged`                                                                       | rumor author ≠ seal author, or equals the ephemeral wrap key                        |
| `unsupported-kind`                                                                    | rumor kind has no decoder (telemetry, foreign kinds)                                |
| `invalid-message`, `invalid-image`, `invalid-edit`, `empty-message`, `nested-payload` | chat codec rejected it ([chat.md](./chat.md#receiving))                             |
| `invalid-reaction`, `invalid-retraction`                                              | reactions codec rejected it ([reactions.md](./reactions.md#receiving))              |
| `invalid-seen-receipt`                                                                | seen-receipts codec rejected it ([seen-receipts.md](./seen-receipts.md#receiving))  |
| `invalid-notice`, `invalid-bank-offer`                                                | payment-kinds codec rejected it ([payment-kinds.md](./payment-kinds.md))            |

Drops are facts too: log them, count them, but never treat one as an error.

## The cursor and `InboxCursorStore`

The inbox tracks the newest authenticated wrap `created_at` (clamped to now, so a sender-controlled future timestamp cannot push it past real time) and checkpoints it to `InboxCursorStore` on every advance. Each subscription asks relays for `since = cursor − NIP59_BACKDATE_MARGIN_SECONDS` (two days), because gift-wrap timestamps are randomized into the past. So:

- Restarts replay a bounded window. Handlers must be idempotent by rumor id.
- `open({ since })` only seeds a session whose store is empty. Once a cursor is saved, `since` is ignored.
- Without a cursor and without `since`, the first subscription has no `since` at all and relays return whatever they keep.

Supply the store through `runLinkstr({ inboxCursorStore })`, `linkstrServices({ inboxCursorStore })` or `LinkstrConfig.inboxCursorStore`; the default is in-memory, so a headless run without one replays the full `since` window every time.

```ts
import { InboxCursorStore, type Pubkey } from "@linky-fit/linkstr";

// One key per identity, so switching accounts never reuses a cursor.
const cursorStoreFor = (pubkey: Pubkey) =>
  InboxCursorStore.fromStringStorage(
    localStorage,
    `myapp.inbox_cursor.${pubkey}`,
  );
```

`fromStringStorage` takes any `{ getItem, setItem }` (`StringStorage`); an unreadable value loads as "no cursor".

## Dedupe

Wraps are deduped across relays by wrap id while the id is in a bounded cache of the last 4096 authenticated wraps. Only authenticated wraps enter it, so a tampered copy from one relay cannot suppress the honest copy from another. Cache eviction, resubscribes and restarts can replay the same rumor, so every fact is idempotent by its rumor id (`messageId`, `reactionId`, `snapshotId`, `receiptId`): apply "insert if absent" and reconcile own echoes by `clientId`.

## `fetchWrapEvent` for notification opens

A push payload names a wrap by id ([push-inbox.md](./push-inbox.md)). Validate the id first with `Schema.is(WrapId)`; it came over the network.

```ts
import { Effect } from "effect";
import { runLinkstr, WrapInbox, type WrapId } from "@linky-fit/linkstr";

const decodePushed = (wrapId: WrapId) =>
  runLinkstr(
    { secretKey, readRelays },
    Effect.flatMap(WrapInbox, (inbox) =>
      inbox.fetchWrapEvent(wrapId, { timeout: "8 seconds" }),
    ).pipe(Effect.catchAll(() => Effect.succeed(null))),
  );
```

- `fetchWrapEvent(wrapId, options?)` fetches `ids: [wrapId]` from the configured read relays unioned with `options.extraRelays`, authenticates and routes the wrap exactly like the subscription, and returns the `WrapInboxEvent` or `null` when nothing matched. It carries no `delivery` phase.
- The package never reads relay hints from a push payload; pass only relays you trust as `extraRelays`, or none.
- `timeout` bounds the whole fan-out and resolves `null` instead of failing; pass one when the caller has its own deadline, as a push event does.
- Fails with `AllRelaysUnreachable` or `NoReadRelaysConfigured`. On `null` or a failure, show a generic notification; the running app receives the real fact through its inbox once it opens.

[testing.md](./testing.md) drives this inbox with a `FakeRelay`; [push-inbox.md](./push-inbox.md) is the identity-free sibling for a push server.
