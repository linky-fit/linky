# React

`@linky-fit/linkstr-react` is the Effect atom binding: one config atom, one runtime atom built from it, a command per direct operation, and stream atoms for the long-running feeds. It re-exports the `@effect/atom-react` surface and the `effect/reactivity` modules (`useAtomSet`, `useAtomValue`, `useAtomMount`, `AtomRegistry`, `AsyncResult`, …), so app code never depends on either itself. It is a private workspace package, not part of the npm release.

## Registry

The atoms live in the registry React reads through `RegistryContext`; without a provider that is atom-react's default registry. An app that also reads atoms outside React, such as boot code or test hooks, builds its own with `AtomRegistry.make({ scheduleTask, defaultIdleTTL: 400 })` (the default registry's settings) and wraps the tree in `RegistryContext.Provider`, so both sides share one runtime. The Linky web app does this in `main.tsx`.

## Configure

`linkstrConfigAtom` holds a `LinkstrConfig | null`. Set it when an identity is available; set it to `null` on logout. While it is null, every command resolves with a `LinkstrNotConfigured` failure. The config is `linkstrServices`'s plus `allowInsecureLocalhost` and `inspector`; key the `inboxCursorStore` storage by pubkey so switching accounts never reuses a cursor.

Build the config from `identityFromNsec(nsec)` and relay strings filtered through `Schema.is(RelayUrl)`, and set it from one effect mounted near the root: `useAtomSet(linkstrConfigAtom)(config)`.

## Identity switches

`linkstrRuntimeAtom` is built from `linkstrConfigAtom`. Any config change (new key, new relay list, inspector toggled) closes the previous runtime with its relay pool and subscriptions, then starts new ones. Treat it as a full restart of linkstr; stream atoms restart with it. A command still running on the closed runtime is interrupted and resolves with an interrupted failure. This holds for every config change, including same-identity ones such as a relay edit or the inspector toggle: the command is never repeated on the new runtime, so nothing started under one key is sent under the next. Treat an interrupted `Exit` like any other failure. The runtime taps the transport with `observeTransport` and `inspectTransport` and provides `RelayHealth.live` and `Inspector.live` or `.disabled` ([diagnostics.md](./diagnostics.md)).

## Call an operation

`useLinkstrCommands()` returns the commands over the nearest atom registry; the object and its functions are stable across renders, so they are safe in hook dependency lists. Outside React, `linkstrCommands(registry)` returns the same commands. Every command resolves with an `Exit` and never rejects, so failures are typed values:

```tsx
const { retractReaction } = useLinkstrCommands();
const exit = await retractReaction(
  new RetractionDraft({ to: peer, reactionIds: [id] }),
);
if (Exit.isFailure(exit)) console.warn(Cause.pretty(exit.cause)); // e.g. LinkstrNotConfigured
```

Each call runs exactly once, on the runtime that is current when the call is made; a config change later in the same synchronous pass does not move it. While that runtime is still being built, the call waits for it. Calls are independent: concurrent calls all run and each resolves with its own result. After the first command the registry keeps the runtime alive, so unmounting the calling component does not cancel a call.

| Command                                    | Operation                                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------------ |
| `enqueueOutbox`                            | `Outbox.enqueue` (`{ op, ref }`)                                                     |
| `enqueuePaymentTelemetry`                  | `Outbox.enqueueTelemetry` (`{ draft, recipient, ref }`)                              |
| `retractReaction`                          | `Reactions.retract`                                                                  |
| `sendSeenReceipt`                          | `SeenReceipts.send`                                                                  |
| `sendPaymentNotice`                        | `PaymentNotices.send`                                                                |
| `sendBankOffer`                            | `BankOffers.send`                                                                    |
| `publishProfile`, `publishStatus`          | `Profiles.publishProfile`, `Profiles.publishStatus`                                  |
| `fetchProfile`, `fetchProfiles`            | `Profiles.fetchProfile`, `Profiles.fetchProfiles`                                    |
| `republishOwnProfile`                      | `Profiles.republishOwnProfile`                                                       |
| `discoverActiveProfiles`, `searchProfiles` | `Profiles.discoverActiveProfiles`, `Profiles.searchProfiles` (`{ query, options? }`) |
| `publishRelayLists`, `fetchOwnRelayLists`  | `RelayLists.publishRelayLists`, `RelayLists.fetchOwnRelayLists`                      |
| `publishMuteList`, `fetchOwnMuteList`      | `MuteList.publishMuteList`, `MuteList.fetchOwnMuteList`                              |
| `fetchWrapEvent`                           | `WrapInbox.fetchWrapEvent` (`{ wrapId, extraRelays? }`)                              |
| `nostrConnectLogin`                        | `NostrConnect.login` (a `NostrConnectRequest`)                                       |
| `sendAppMessage`                           | `AppMessages.send`                                                                   |
| `publishAppData`, `fetchAppData`           | `AppData.publish`, `AppData.fetch`                                                   |
| `run`                                      | Any effect over the linkstr services, with the same guarantees                       |

Chat sends and reaction adds go through `enqueueOutbox` ([outbox.md](./outbox.md)); there is no `sendText` command. Use `run` for app-specific effects that need a linkstr service, such as signing with `LinkstrIdentity` or publishing through `NostrTransport`.

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
- The `fetchWrapEvent` command is the one-shot counterpart for notification opens.

## Outbox

`enqueueOutbox` resolves as soon as the job is stored; delivery happens in the background and reports through `useOutboxResults(handler)`, which mounts the results stream for the component's lifetime and reads the handler through a ref, so a new closure on every render is fine. A job is acked only after your `async` handler resolves; a rejection skips the ack, so the result is re-delivered on the next runtime build. Mount it once, high in the tree, and switch on `result._tag` as [outbox.md](./outbox.md#results) describes.

For manual registration, set `outboxResultsHandlerAtom` to `{ onResult }` and mount `outboxResultsAtom` once. Set the handler to `null` on cleanup; a null handler leaves results unconsumed. Use either this pair or `useOutboxResults`, with the same ack guarantees.

## Profile watch

`watchedProfilesAtom` (the pubkey set), `profileWatchHandlerAtom` (`{ onEvent }`) and `profileWatchAtom` follow the inbox pattern: set the handler once (through a ref, as above), mount `profileWatchAtom`, and set `watchedProfilesAtom` whenever the set changes; that resubscribes without rebuilding the runtime. Swapping the handler object also reopens the subscriptions. Facts are in [plain-events.md](./plain-events.md#watching).

## Mute list watch

`muteListWatchHandlerAtom` (`{ onList }`) and `muteListWatchAtom` follow the inbox pattern: set the handler once per identity session, keep `muteListWatchAtom` mounted, and each list `MuteList.watchOwnMuteList` emits reaches `onList`. Swapping the handler object or the config reopens the subscriptions. When to publish after a merge is in [plain-events.md](./plain-events.md#mute-list).

## Relay health and inspector

- `relayHealthAtom`: `AsyncResult<ReadonlyMap<string, RelayHealthState>>`, keyed by plain string so UI code can look up its own relay list; read with `useAtomValue` and `AsyncResult.isSuccess`, treat a missing entry as "checking". It resets when the runtime is rebuilt.
- `inspectorHandlerAtom` + `inspectorEventsAtom`: set `{ onEvent }` and mount the atom; it streams only while `config.inspector` is true. Wrap `onEvent` in a `try` if a mapping bug must not kill the feed.

## Testing

Tests drive commands and atoms with a bare `AtomRegistry.make()` instead of rendering; helpers and an example are in [testing.md](./testing.md#linky-fitlinkstr-reacttesting).
