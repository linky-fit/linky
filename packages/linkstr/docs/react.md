# React

`@linky-fit/linkstr-react` is the Effect atom binding: one config atom, one runtime atom built from it, and a fn atom per direct operation. It re-exports the `@effect/atom-react` surface and the `effect/reactivity` modules (`useAtomSet`, `useAtomValue`, `useAtomMount`, `AtomRegistry`, `AsyncResult`, …), so app code never depends on either itself. It is a private workspace package, not part of the npm release.

## Configure

`linkstrConfigAtom` holds a `LinkstrConfig | null`. Set it when an identity is available; set it to `null` on logout. While it is null, every fn atom fails with `LinkstrNotConfigured`. The config is `linkstrServices`'s plus `allowInsecureLocalhost` and `inspector`; key the `inboxCursorStore` storage by pubkey so switching accounts never reuses a cursor.

Build the config from `identityFromNsec(nsec)` and relay strings filtered through `Schema.is(RelayUrl)`, and set it from one effect mounted near the root: `useAtomSet(linkstrConfigAtom)(config)`.

## Identity switches

`linkstrRuntimeAtom` is built from `linkstrConfigAtom`. Any config change (new key, new relay list, inspector toggled) closes the previous runtime with its relay pool and subscriptions, then starts new ones. Treat it as a full restart of linkstr; stream atoms restart with it. The runtime taps the transport with `observeTransport` and `inspectTransport` and provides `RelayHealth.live` and `Inspector.live` or `.disabled` ([diagnostics.md](./diagnostics.md)).

## Call an operation

Every operation is a `linkstrRuntimeAtom.fn` atom. `useAtomSet(atom, { mode: "promiseExit" })` returns a function that resolves with an `Exit`; call it from a handler. `mode: "promise"` resolves with the value and rejects on failure; the default mode returns `void` and you read the atom's `AsyncResult` with `useAtomValue`. Prefer `promiseExit` in event handlers: failures are typed values, not thrown.

```tsx
const retract = useAtomSet(retractReactionAtom, { mode: "promiseExit" });
const exit = await retract(
  new RetractionDraft({ to: peer, reactionIds: [id] }),
);
if (Exit.isFailure(exit)) console.warn(Cause.pretty(exit.cause)); // e.g. LinkstrNotConfigured
```

| Atom                                               | Operation                                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `enqueueOutboxAtom`                                | `Outbox.enqueue` (`{ op, ref }`)                                                     |
| `enqueuePaymentTelemetryAtom`                      | `Outbox.enqueueTelemetry` (`{ draft, recipient, ref }`)                              |
| `outboxResultsHandlerAtom`, `outboxResultsAtom`    | Register `{ onResult }`, then mount to consume and ack completed outbox jobs         |
| `retractReactionAtom`                              | `Reactions.retract`                                                                  |
| `sendSeenReceiptAtom`                              | `SeenReceipts.send`                                                                  |
| `sendPaymentNoticeAtom`                            | `PaymentNotices.send`                                                                |
| `sendBankOfferAtom`                                | `BankOffers.send`                                                                    |
| `publishProfileAtom`, `publishStatusAtom`          | `Profiles.publishProfile`, `Profiles.publishStatus`                                  |
| `fetchProfileAtom`, `fetchProfilesAtom`            | `Profiles.fetchProfile`, `Profiles.fetchProfiles`                                    |
| `republishOwnProfileAtom`                          | `Profiles.republishOwnProfile`                                                       |
| `discoverActiveProfilesAtom`, `searchProfilesAtom` | `Profiles.discoverActiveProfiles`, `Profiles.searchProfiles` (`{ query, options? }`) |
| `publishRelayListsAtom`, `fetchOwnRelayListsAtom`  | `RelayLists.publishRelayLists`, `RelayLists.fetchOwnRelayLists`                      |
| `publishMuteListAtom`, `fetchOwnMuteListAtom`      | `MuteList.publishMuteList`, `MuteList.fetchOwnMuteList`                              |
| `fetchWrapEventAtom`                               | `WrapInbox.fetchWrapEvent` (`{ wrapId, extraRelays? }`)                              |
| `nostrConnectLoginAtom`                            | `NostrConnect.login` (a `NostrConnectRequest`)                                       |
| `sendAppMessageAtom`                               | `AppMessages.send`                                                                   |
| `publishAppDataAtom`, `fetchAppDataAtom`           | `AppData.publish`, `AppData.fetch`                                                   |

Chat sends and reaction adds go through `enqueueOutboxAtom` ([outbox.md](./outbox.md)); there is no `sendTextAtom`.

## Inbox

Register a handler, then keep `wrapInboxAtom` mounted. The inbox opens when both a runtime and a handler exist and closes when either goes away. Every new handler object reopens the relay subscriptions, so register once per identity session and reach per-render state through a ref:

```tsx
import {
  UnixSeconds,
  type InboxDelivery,
  type WrapInboxEvent,
} from "@linky-fit/linkstr";
import {
  useAtomMount,
  useAtomSet,
  wrapInboxAtom,
  wrapInboxHandlerAtom,
} from "@linky-fit/linkstr-react";
import React from "react";

/** Backfill window for a first session without a stored cursor. */
const LOOKBACK_SECONDS = 3 * 24 * 60 * 60;

export const useInboxSync = (
  onEvent: (event: WrapInboxEvent, delivery: InboxDelivery) => void,
) => {
  const latest = React.useRef(onEvent);
  React.useEffect(() => {
    latest.current = onEvent;
  });
  const setHandler = useAtomSet(wrapInboxHandlerAtom);
  useAtomMount(wrapInboxAtom);

  React.useEffect(() => {
    setHandler({
      since: UnixSeconds.make(Math.floor(Date.now() / 1000) - LOOKBACK_SECONDS),
      onEvent: (event, delivery) => latest.current(event, delivery),
    });
    return () => setHandler(null);
  }, [setHandler]);
};
```

- Run **one** sync loop per app. The feed is single-consumer; fan out inside your handler by `_tag`.
- Return the promise of what the handler stores; the event is acked when it resolves. A rejection leaves it unacked (`InboxEventUnconfirmed`).
- `since` only matters on a first session with an empty cursor store ([inbox.md](./inbox.md#the-cursor-and-inboxcursorstore)).
- `fetchWrapEventAtom` is the one-shot counterpart for notification opens.

## Outbox

`enqueueOutboxAtom` resolves as soon as the job is stored; delivery happens in the background and reports through `useOutboxResults(handler)`, which mounts the results stream for the component's lifetime and reads the handler through a ref, so a new closure on every render is fine. A job is acked only after your `async` handler resolves; a rejection skips the ack, so the result is re-delivered on the next runtime build. Mount it once, high in the tree, and switch on `result._tag` as [outbox.md](./outbox.md#results) describes.

For manual registration, set `outboxResultsHandlerAtom` to `{ onResult }` and mount `outboxResultsAtom` once. Set the handler to `null` on cleanup; a null handler leaves results unconsumed. Use either this pair or `useOutboxResults`, with the same ack guarantees.

## Profile watch

`watchedProfilesAtom` (the pubkey set), `profileWatchHandlerAtom` (`{ onEvent }`) and `profileWatchAtom` follow the inbox pattern: set the handler once (through a ref, as above), mount `profileWatchAtom`, and set `watchedProfilesAtom` whenever the set changes; that resubscribes without rebuilding the runtime. Swapping the handler object also reopens the subscriptions. Facts are in [plain-events.md](./plain-events.md#watching).

## Relay health and inspector

- `relayHealthAtom`: `AsyncResult<ReadonlyMap<string, RelayHealthState>>`, keyed by plain string so UI code can look up its own relay list; read with `useAtomValue` and `AsyncResult.isSuccess`, treat a missing entry as "checking". It resets when the runtime is rebuilt.
- `inspectorHandlerAtom` + `inspectorEventsAtom`: set `{ onEvent }` and mount the atom; it streams only while `config.inspector` is true. Wrap `onEvent` in a `try` if a mapping bug must not kill the feed.

## Testing

Tests drive atoms with a bare `AtomRegistry.make()` instead of rendering; helpers and an example are in [testing.md](./testing.md#linky-fitlinkstr-reacttesting).
