# Push inbox

`PushInbox` watches kind-1059 traffic for a server that has no keys: it verifies outer wraps, extracts the recipient, and tells you whether each arrival is backfill or live. You need it only when building push infrastructure; client code uses [`WrapInbox`](./inbox.md). Gift wrap, EOSE and backfill are defined in [concepts.md](./concepts.md#vocabulary).

## The `["linky", "push"]` marker

Senders opt a wrap into push by adding a `["linky", "push"]` tag to the recipient copy: chat text and files, payment notices and pushable bank-offer statuses set it; token messages, edits, reactions and seen receipts do not ([kind index](./README.md#kind-index)). The subscription filter is only `{ kinds: [1059], since }`, because relays do not reliably index multi-letter tags; the codec checks the marker client-side and silently ignores wraps without it.

## `watchPushInbox`

The Promise-facing entry for long-lived services. No identity is needed. Keep the subscription handle and close it from your shutdown path:

```ts
import { RelayUrl, watchPushInbox } from "@linky-fit/linkstr";

/** Placeholder: look up subscriptions for `recipient` and send the push. */
declare const notify: (recipient: string, wrapId: string) => void;

const subscription = watchPushInbox(
  {
    readRelays: ["wss://relay.damus.io", "wss://nos.lol"].map((url) =>
      RelayUrl.make(url),
    ),
    lookbackSeconds: 3 * 24 * 60 * 60,
    onInvalidWrap: (failure) => console.warn("invalid push wrap", failure),
    onRelayStatus: (event) =>
      event.type === "eose"
        ? console.info("caught up", event.relay)
        : console.warn("attempt ended", event.relay, event.reason),
    onFatal: (message) => {
      console.error("push watcher stopped", message);
      process.exit(1); // let the process supervisor restart it
    },
  },
  ({ delivery, wrap }) => {
    if (delivery === "backfill") return;
    notify(wrap.recipient, wrap.wrapId);
  },
);

process.on("SIGTERM", () => {
  void subscription.close().then(() => process.exit(0));
});
```

| Config                   | Meaning                                                                    |
| ------------------------ | -------------------------------------------------------------------------- |
| `readRelays`             | relays to subscribe on; one reconnecting subscription each                 |
| `lookbackSeconds`        | `since = now − lookback` on every (re)subscription                         |
| `allowInsecureLocalhost` | opt into loopback `ws://` for development; default false                   |
| `refreshInterval`        | force a fresh REQ this often (default 10 min) to detect deaf subscriptions |
| `resubscribeDelay`       | base backoff after an attempt ends (default 5 s)                           |
| `transport`              | test seam; defaults to the websocket pool transport                        |
| `onInvalidWrap`          | called for every `PushWrapFailure` except `missing-push-marker`            |
| `onRelayStatus`          | `{ type: "eose", relay }` or `{ type: "attempt-ended", relay, reason }`    |
| `onFatal`                | the whole watcher died with a non-interrupt cause                          |

Each `DeliveredPushWrap` is `{ delivery, wrap }` with `wrap: PushWrap = { wrapId, recipient, createdAt }`. That is everything a notification payload needs: the client fetches and decrypts the wrap itself with `WrapInbox.fetchWrapEvent(wrapId)` from its own relays ([inbox.md](./inbox.md#fetchwrapevent-for-notification-opens)). The wrap's `p` tags may carry sender-controlled relay hints; the codec does not surface them.

Per-relay reconnects are automatic and never reach `onFatal`. `onFatal` means the watcher fiber itself died and nothing restarts it: call `watchPushInbox` again from the callback, or exit and let the supervisor restart the process. For an Effect composition use `PushInbox.open(options)` directly: it returns a scoped `Stream<DeliveredPushWrap>` over `RelayPolicy` and `NostrTransport`, and fails with `NoReadRelaysConfigured`.

## Backfill vs live, and dedupe

- Every subscription attempt starts in `backfill`; the first EOSE from that relay flips it to `live`. After a reconnect the relay replays its window, so those arrivals are backfill again.
- Live wraps are deduped across relays by wrap id (a bounded cache of the last 4096 authenticated wraps), so you see each live wrap once while it stays cached.
- Backfill wraps are **re-emitted per copy**. Suppress them yourself and do not record them, so a later live copy of the same wrap is still delivered. Keep a ledger only of wraps you attempted to deliver.

## The push codec

`decodePushWrap(raw)` returns `Either<PushWrap, PushWrapFailure>`:

| Failure                      | Cause                                                       |
| ---------------------------- | ----------------------------------------------------------- |
| `missing-push-marker`        | no `["linky","push"]` tag (not reported to `onInvalidWrap`) |
| `malformed-event`            | not a signed wrap                                           |
| `wrong-kind`                 | kind ≠ 1059                                                 |
| `invalid-signature`          | outer signature fails                                       |
| `unexpected-recipient-count` | not exactly one distinct `p` pubkey                         |

The outer signature authenticates the id, tags and ciphertext for routing and dedupe. The server never decrypts anything.

## Proving ownership of a subscription

Subscribing a pubkey to push should require a signed kind-27235 proof. The client builds it with `makePushOwnershipProof({ action, challenge }, secretKey, now)`; the server checks it with `verifyPushOwnershipProof(event)`. Details in [http-auth.md](./http-auth.md).
