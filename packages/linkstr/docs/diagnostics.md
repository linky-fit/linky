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

`RelayHealthSnapshot` is `ReadonlyMap<RelayUrl, RelayHealthState>`:

| Field         | Meaning                                                                      |
| ------------- | ---------------------------------------------------------------------------- |
| `state`       | `"connecting"` \| `"connected"` \| `"unreachable"`                           |
| `detail`      | last close or error reason; meaningful while `unreachable`                   |
| `lastSeenAt`  | last proof the relay served us (event, EOSE, fetch result, accepted publish) |
| `lastErrorAt` | last failure timestamp                                                       |
| `lastPublish` | `{ at, accepted, detail }` of the most recent publish, or null               |

A relay appears in the map only after some traffic touched it. Write-only relays may never subscribe, so their freshest signal is `lastPublish`; show its timestamp.

| Traffic                                              | Effect on state                                                                                |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| subscribe attempt starts                             | `connecting` (unless already `connected`)                                                      |
| event received, EOSE, fetch result                   | `connected`, `detail` cleared, `lastSeenAt` updated                                            |
| accepted publish                                     | `connected` plus `lastPublish`                                                                 |
| rejected publish                                     | only `lastPublish` and `lastErrorAt`; state untouched (a policy rejection is not a dead relay) |
| subscription ended, `RelayUnreachable`, fetch failed | `unreachable` with the reason                                                                  |

The resubscribe loops of the inbox and profile watch flip an unreachable relay back to `connecting` on the next attempt. Value-equal transitions are skipped, so a flood costs at most one write per relay per second.

Read it through the `RelayHealth` service: `current` is an `Effect` of the snapshot; `changes` is a `Stream` that emits the current snapshot on subscription and again on every change. In React read `relayHealthAtom` and treat a missing entry as "checking".

## Inspector

| Member               | Meaning                                                                                               |
| -------------------- | ----------------------------------------------------------------------------------------------------- |
| `Inspector.live`     | real bus: sliding queue of 1024 events; old rows drop when nobody consumes                            |
| `Inspector.disabled` | no-op service, for roots that must provide the tag unconditionally                                    |
| `Inspector.orNoop`   | what emitters use: the service if provided, else a no-op                                              |
| `emit(build)`        | sync and lazy; `build` runs only when a real bus exists, and a throwing builder is logged and dropped |
| `events`             | single-consumer `Stream<InspectorEvent>`                                                              |

Consume `events` with `Stream.runForEach` from a fiber forked (`Effect.forkScoped`) in the same scope as the operations you want to see; leaving the scope stops the consumer and releases the bus. In React set `inspectorHandlerAtom` and mount `inspectorEventsAtom` ([react.md](./react.md#relay-health-and-inspector)).

### Event families

| Group           | Event                                                                                                 | Fired when                                                             |
| --------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Operations      | `OperationSucceeded` (`name`, `params`, `rumorId`, `clientId`, `sentAt`, `selfCopy`, `recipientCopy`) | a wrap vertical finished a send, e.g. `reactions.react`                |
| Operations      | `OperationFailed` (`name`, `params`, `error`)                                                         | any vertical's send failed, or an outbox job failed                    |
| Operations      | `PlainOperationSucceeded` (`name`, `params`, `eventIds`, `result`)                                    | a plain publish, a fetch, `outbox.enqueue`, `outbox.job`               |
| Inbox and watch | `InboxRouted` (`wrapId`, `rumorKind`, `delivery`, `event`)                                            | the inbox produced a fact, including `WrapDropped`                     |
| Inbox and watch | `InboxWrapDeduped` (`wrapId`)                                                                         | a cross-relay duplicate was skipped                                    |
| Inbox and watch | `ProfileWatchRouted` (`eventId`, `kind`, `event`)                                                     | `ProfileWatch` routed or dropped (`ProfileEventDropped`) a plain event |
| Wire            | `WirePublished` (`wrapId`, `wrap`, `results`)                                                         | one signed wrap pushed to the write relays                             |
| Wire            | `WirePlainPublished` (`eventId`, `kind`, `event`, `results`)                                          | one signed plain event pushed                                          |
| Wire            | `WireSubscribed`, `WireSubscriptionEnded`, `WireEventReceived`                                        | subscription lifecycle and raw arrivals, per relay                     |
| Wire            | `WireFetched` (`relay`, `filter`, `events`, `detail`)                                                 | one one-shot fetch answered or failed                                  |

Operation names are `<vertical>.<operation>` (`chat.sendText`, `bankOffers.send`, `profiles.fetchProfile`, `inbox.fetchWrapEvent`, …). Rows correlate through shared ids: `OperationSucceeded.selfCopy.wrapId` and `recipientCopy.wrapId` match two `WirePublished.wrapId`s; `rumorId` / `clientId` tie a send to its `InboxRouted` echo and to outbox rows. `InboxRouted.rumorKind` is how an unknown kind shows up.

### What the inspector never contains

No key material, in any field: not an nsec, seed words or a `NostrSecretKey`, not an attachment's AES-GCM `key` / `nonce`, not cashu token text. `params`, `result` and `event` payloads are redacted before emission: a `PrivateImage` appears without `key` and `nonce` (url, hashes, size and dimensions stay) and a `token` field holding a cashu token is replaced by a placeholder. Telemetry rows carry `{ draft, recipient }`, never the per-attempt signing key; `WirePublished.wrap` and `WireEventReceived.event` are ciphertext. Decrypted message text is present by design, so treat a captured timeline as private.

## Related

- [react.md](./react.md#relay-health-and-inspector) — `relayHealthAtom`, `inspectorEventsAtom`
- [inbox.md](./inbox.md) — the facts `InboxRouted` wraps
