# Inbox

`WrapInbox` is the one kind-1059 subscription: it backfills from a persisted cursor, authenticates every gift wrap, and hands you typed facts on a single stream. You need it whenever your process should receive messages, reactions, notices, offers, or receipts, and for one-shot decoding when a push notification names a wrap. Terms like rumor, own echo, and EOSE are defined in [concepts.md](./concepts.md#vocabulary).

## Open the feed

Prerequisite: a configured runtime ([getting-started.md](./getting-started.md#first-run) shows one).

```ts
import { Effect, Stream } from "effect";
import { UnixSeconds, WrapInbox } from "@linky/linkstr";

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
- Options: `since` (backfill start, used only when the cursor store is empty) and `resubscribeDelay` (base of the per-relay backoff, default 5s).
- Fails with `NoReadRelaysConfigured` when `RelayPolicy.readRelays` is empty.
- `feed.events` is `Stream<DeliveredInboxEvent>`: `{ delivery, event }`. It is **single-consumer**; if two parts of your app need it, consume once and fan out.
- `delivery` is `"backfill"` until the delivering relay sends EOSE, its end-of-stored-events marker, then `"live"`. Interrupt the user (toast, notification) for live events only.

## The event union

`event` is a `WrapInboxEvent`. Dispatch on `_tag`:

| Vertical        | Peer-authored fact                   | Own echo                                         |
| --------------- | ------------------------------------ | ------------------------------------------------ |
| Chat            | `ChatMessageReceived`                | `OwnChatMessageConfirmed`                        |
| Reactions       | `ReactionAdded`, `ReactionRetracted` | `OwnReactionConfirmed`, `OwnRetractionConfirmed` |
| Payment notices | `PaymentNoticeReceived`              | —                                                |
| Bank offers     | `BankOfferSnapshotReceived`          | `OwnBankOfferSnapshotConfirmed`                  |
| Seen receipts   | `SeenReceiptReceived`                | `OwnSeenReceiptConfirmed`                        |
| (any)           | `WrapDropped`                        |                                                  |

Own echoes carry `clientId` (nullable) so you can reconcile an optimistic local row; peer facts carry `from`.

```ts
import { Match } from "effect";
import type { WrapInboxEvent } from "@linky/linkstr";

const describe = (event: WrapInboxEvent): string =>
  Match.value(event).pipe(
    Match.tag("ChatMessageReceived", (e) => `${e.from}: ${e.body._tag}`),
    Match.tag(
      "OwnChatMessageConfirmed",
      (e) => `echo of ${e.messageId} to ${e.to}`,
    ),
    Match.tag(
      "ReactionAdded",
      (e) => `${e.from} reacted ${e.emoji} to ${e.target}`,
    ),
    Match.tag("WrapDropped", (e) => `dropped ${e.wrapId ?? "?"}: ${e.reason}`),
    Match.orElse((e) => e._tag),
  );
```

A `switch (event._tag)` works the same way. Use `Match.tagsExhaustive` when you want the compiler to force a branch per tag. The web app's single consumer, `apps/web-app/src/app/hooks/messages/useLinkstrInboxSync.ts`, is a `switch` with grouped `case`s that hands each vertical to its own module; the React wiring is in [react.md](./react.md#inbox).

## `WrapDropped`

A wrap the inbox chose not to surface, with `wrapId` (null when the outer event was malformed) and a `reason`:

| Reason                                                                                | Meaning                                                      |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `malformed-wrap`                                                                      | not a valid signed kind-1059 event                           |
| `not-addressed-to-me`                                                                 | no `p` tag with our pubkey                                   |
| `unwrap-failed`                                                                       | decryption failed                                            |
| `invalid-seal`                                                                        | seal does not decode or its signature fails                  |
| `sender-forged`                                                                       | rumor author ≠ seal author, or equals the ephemeral wrap key |
| `malformed-rumor`, `forged-rumor-id`                                                  | rumor does not decode, or its id ≠ its hash                  |
| `unsupported-kind`                                                                    | rumor kind has no vertical yet                               |
| `invalid-reaction`, `invalid-retraction`                                              | reactions codec rejected it                                  |
| `invalid-message`, `invalid-image`, `invalid-edit`, `empty-message`, `nested-payload` | chat codec rejected it                                       |
| `invalid-notice`, `invalid-bank-offer`, `invalid-seen-receipt`                        | that vertical's codec rejected it                            |

Drops are facts too: log them, count them, but never treat one as an error.

## The cursor and `InboxCursorStore`

The inbox tracks the newest authenticated wrap `created_at` (clamped to now) and checkpoints it to `InboxCursorStore` on every advance. Each subscription asks relays for `since = cursor - NIP59_BACKDATE_MARGIN_SECONDS` (two days), because gift-wrap timestamps are randomized into the past. So:

- Restarts replay a bounded window. Dedupe and idempotency absorb it; your handlers must be idempotent by rumor id.
- `open({ since })` only seeds a session whose store is empty. Once a cursor is saved, `since` is ignored.
- Without a cursor and without `since`, the first subscription has no `since` at all and relays return whatever they keep.

Supply the store through `linkstrServices({ inboxCursorStore })` or `LinkstrConfig.inboxCursorStore`; `runLinkstr` and the default are in-memory.

```ts
import { InboxCursorStore, type Pubkey } from "@linky/linkstr";

// web: one key per identity, so switching accounts never reuses a cursor
const cursorStoreFor = (pubkey: Pubkey) =>
  InboxCursorStore.fromStringStorage(
    localStorage,
    `linky.inbox_cursor.${pubkey}`,
  );
```

`fromStringStorage` takes any `{ getItem, setItem }` (`StringStorage`); an unreadable value loads as "no cursor".

## `fetchWrapEvent` for notification opens

A push payload names a wrap by id and lists relay hints ([push-inbox.md](./push-inbox.md)). Validate the id first; it came over the network.

```ts
import { Effect, Schema } from "effect";
import {
  runLinkstr,
  WrapId,
  WrapInbox,
  type NostrSecretKey,
  type RelayUrl,
  type WrapInboxEvent,
} from "@linky/linkstr";

const isWrapId = Schema.is(WrapId);

const decodePushed = (
  secretKey: NostrSecretKey,
  readRelays: ReadonlyArray<RelayUrl>,
  outerEventId: string,
  relayHints: ReadonlyArray<RelayUrl>,
): Promise<WrapInboxEvent | null> => {
  if (!isWrapId(outerEventId)) return Promise.resolve(null);
  return runLinkstr(
    { secretKey, readRelays },
    Effect.flatMap(WrapInbox, (inbox) =>
      inbox.fetchWrapEvent(outerEventId, {
        extraRelays: relayHints,
        timeout: "8 seconds",
      }),
    ).pipe(
      Effect.catchTags({
        AllRelaysUnreachable: () => Effect.succeed(null),
        NoReadRelaysConfigured: () => Effect.succeed(null),
      }),
    ),
  );
};
```

- Fetches `ids: [wrapId]` from the read relays unioned with `extraRelays`, authenticates, routes, and returns the same `WrapInboxEvent`, or `null` when nothing matched.
- With `timeout`, a slow fan-out resolves `null` instead of failing. Pass one when the caller has its own deadline, as a push event does.
- Fails with `AllRelaysUnreachable` (no relay answered) or `NoReadRelaysConfigured`.
- On `null` or a failure, show a generic "new message" notification; the running app receives the real fact through its inbox once it opens. That is what `apps/web-app/src/sw.ts` does.
- No `delivery` phase; it is not a subscription.

## Dedup guarantees

- Wraps are deduped across relays by wrap id while the id is in a bounded cache (the last 4096 authenticated wraps). Only authenticated wraps enter it, so a tampered copy from one relay cannot suppress the honest copy from another.
- Duplicates are suppressed only while their wrap ids stay cached: cache eviction, resubscribes, and restarts can replay the same rumor. Every fact is idempotent by its rumor id (`messageId`, `reactionId`, `snapshotId`, `receiptId`), so apply "insert if absent" and reconcile own echoes by `clientId`.

## Related

- [concepts.md](./concepts.md) — why facts are a tagged union
- [react.md](./react.md) — mounting the inbox in the app
- [push-inbox.md](./push-inbox.md) — the identity-free sibling for the push server
- [testing.md](./testing.md) — driving the inbox with `FakeRelay`
