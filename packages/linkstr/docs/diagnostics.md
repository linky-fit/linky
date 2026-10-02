# Diagnostics

Two optional services observe what linkstr does on the wire. `RelayHealth` folds a per-relay connection status from real traffic and is meant for production UI; `Inspector` is a diagnostics bus that streams typed events for a timeline view. Both are fed by decorating the transport layer; without the decorator or the service nothing breaks, the snapshot just stays empty and emissions cost nothing.

## Composing both

`observeTransport` (relay health) and `inspectTransport` (inspector) are transparent taps over any `NostrTransport` layer; each passes through when its service is not provided.

```ts
import { Layer } from "effect";
import {
  Inspector,
  inspectTransport,
  linkstrServices,
  NostrTransportSimplePool,
  observeTransport,
  RelayHealth,
  type NostrSecretKey,
  type RelayUrl,
} from "@linky-fit/linkstr";

export const observedServices = (
  secretKey: NostrSecretKey,
  relays: ReadonlyArray<RelayUrl>,
  inspect: boolean,
) =>
  linkstrServices({
    secretKey,
    readRelays: relays,
    writeRelays: relays,
    transport: inspectTransport(observeTransport(NostrTransportSimplePool)),
  }).pipe(
    Layer.provideMerge(inspect ? Inspector.live : Inspector.disabled),
    Layer.provideMerge(RelayHealth.live),
  );
```

This is exactly what the React runtime does ([react.md](./react.md#relay-health-and-inspector)). `runLinkstr` composes neither, so headless runs have an empty snapshot and no inspector feed.

## Relay health

`RelayHealth.current` is an `Effect` of the `RelayHealthSnapshot` (a map from relay to `RelayHealthState`); `changes` is a `Stream` that emits the current snapshot on subscription and again on every change. A relay appears in the map only after some traffic touched it. Write-only relays may never subscribe, so their freshest signal is `lastPublish`; show its timestamp. In React read `relayHealthAtom` and treat a missing entry as "checking".

| Traffic                                              | Effect on state                                                                                |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| subscribe attempt starts                             | `connecting` (unless already `connected`)                                                      |
| event received, EOSE, fetch result                   | `connected`, `detail` cleared, `lastSeenAt` updated                                            |
| accepted publish                                     | `connected` plus `lastPublish`                                                                 |
| rejected publish                                     | only `lastPublish` and `lastErrorAt`; state untouched (a policy rejection is not a dead relay) |
| subscription ended, `RelayUnreachable`, fetch failed | `unreachable` with the reason                                                                  |

The resubscribe loops of the inbox and profile watch flip an unreachable relay back to `connecting` on the next attempt. Value-equal transitions are skipped, so a flood costs at most one write per relay per second.

## Inspector

`Inspector.live` is the real bus, a sliding queue of 1024 events that drops old rows when nobody consumes; `Inspector.disabled` is a no-op for roots that must provide the tag unconditionally. `emit(build)` is sync and lazy: `build` runs only when a real bus exists, and a throwing builder is logged and dropped. `events` is a single-consumer `Stream<InspectorEvent>`; consume it with `Stream.runForEach` from a fiber forked (`Effect.forkScoped`) in the same scope as the operations you want to see; leaving the scope stops the consumer and releases the bus. In React set `inspectorHandlerAtom` and mount `inspectorEventsAtom` ([react.md](./react.md#relay-health-and-inspector)).

### Event families

| Group           | Event                                                          | Fired when                                                             |
| --------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Operations      | `OperationSucceeded`                                           | a wrap vertical finished a send, e.g. `reactions.react`                |
| Operations      | `OperationFailed`                                              | any vertical's send failed, or an outbox job failed                    |
| Operations      | `PlainOperationSucceeded`                                      | a plain publish, a fetch, `outbox.enqueue`, `outbox.job`               |
| Inbox and watch | `InboxRouted`                                                  | the inbox produced a fact, including `WrapDropped`                     |
| Inbox and watch | `InboxWrapDeduped`                                             | a cross-relay duplicate was skipped                                    |
| Inbox and watch | `InboxWalkGivenUp`                                             | a relay stopped holding the inbox cursor after failing three attempts  |
| Inbox and watch | `InboxEventUnconfirmed`                                        | linkstr-react's inbox handler rejected, so the event stays unconfirmed |
| Inbox and watch | `ProfileWatchRouted`                                           | `ProfileWatch` routed or dropped (`ProfileEventDropped`) a plain event |
| Wire            | `WirePublished`                                                | one signed wrap pushed to the write relays                             |
| Wire            | `WirePlainPublished`                                           | one signed plain event pushed                                          |
| Wire            | `WireSubscribed`, `WireSubscriptionEnded`, `WireEventReceived` | subscription lifecycle and raw arrivals, per relay                     |
| Wire            | `WireFetched`                                                  | one one-shot fetch answered or failed                                  |

Operation names are `<vertical>.<operation>` (`chat.sendText`, `bankOffers.send`, `profiles.fetchProfile`, `inbox.fetchWrapEvent`, …). Rows correlate through shared ids: `OperationSucceeded.selfCopy.wrapId` and `recipientCopy.wrapId` match two `WirePublished.wrapId`s; `rumorId` / `clientId` tie a send to its `InboxRouted` echo and to outbox rows. `InboxRouted.rumorKind` is how an unknown kind shows up.

### What the inspector never contains

No key material, in any field: not an nsec, seed words or a `NostrSecretKey`, not an attachment's AES-GCM `key` / `nonce`, not cashu token text. `params`, `result` and `event` payloads are redacted before emission: a `PrivateImage` appears without `key` and `nonce` (url, hashes, size and dimensions stay) and a `token` field holding a cashu token is replaced by a placeholder. Telemetry rows carry `{ draft, recipient }`, never the per-attempt signing key; `WirePublished.wrap` and `WireEventReceived.event` are ciphertext. Decrypted message text is present by design, so treat a captured timeline as private.
