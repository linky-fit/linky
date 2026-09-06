# Inspector

`Inspector` is an optional diagnostics bus: verticals and the transport tap emit typed events into it, and one consumer streams them out. Turn it on when you want a timeline of what linkstr does on the wire (the web app's inspector page). When it is off, every emission site goes through a no-op and costs nothing.

## Consuming in React

Set `LinkstrConfig.inspector: true`, register a handler, and mount the events atom:

```tsx
import type { InspectorEvent } from "@linky/linkstr";
import {
  inspectorEventsAtom,
  inspectorHandlerAtom,
  useAtomMount,
  useAtomSet,
} from "@linky/linkstr-react";
import React from "react";

export const useInspectorBridge = (
  enabled: boolean,
  report: (event: InspectorEvent) => void,
) => {
  const setHandler = useAtomSet(inspectorHandlerAtom);
  useAtomMount(inspectorEventsAtom);
  React.useEffect(() => {
    if (!enabled) return;
    setHandler({ onEvent: report });
    return () => setHandler(null);
  }, [enabled, report, setHandler]);
};
```

The web app's `apps/web-app/src/devtools/inspector/useLinkstrInspectorBridge.ts` does this and converts each event to an inspector row with `linkstrEventToRow`, wrapped in a `try` so a mapping bug cannot kill the feed fiber. With `inspector: false` the atom mounts but emits nothing. The runtime atom already taps the transport, so no further wiring is needed.

## Consuming in Effect

Provide `Inspector.live` to the services, tap the transport, and consume `events` from a fiber forked in the same scope. Leaving the scope stops the consumer and releases the bus.

```ts
import { Effect, Layer, Stream } from "effect";
import {
  Inspector,
  inspectTransport,
  linkstrServices,
  NostrTransportSimplePool,
  observeTransport,
  Reactions,
  type NostrSecretKey,
  type ReactionDraft,
  type RelayUrl,
} from "@linky/linkstr";

const inspectedServices = (
  secretKey: NostrSecretKey,
  relays: ReadonlyArray<RelayUrl>,
  enabled: boolean,
) =>
  linkstrServices({
    secretKey,
    readRelays: relays,
    writeRelays: relays,
    transport: inspectTransport(observeTransport(NostrTransportSimplePool)),
  }).pipe(Layer.provideMerge(enabled ? Inspector.live : Inspector.disabled));

const reactWithTimeline = (draft: ReactionDraft) =>
  Effect.scoped(
    Effect.gen(function* () {
      const inspector = yield* Inspector;
      yield* Effect.forkScoped(
        Stream.runForEach(inspector.events, (event) =>
          Effect.sync(() => console.log(event._tag, event)),
        ),
      );
      const reactions = yield* Reactions;
      return yield* reactions.react(draft);
    }),
  );
```

Run `reactWithTimeline(draft)` with `Effect.provide(inspectedServices(...))`. The stream is single-consumer; fan out downstream if several views need it.

## The port

| Member               | Meaning                                                                                               |
| -------------------- | ----------------------------------------------------------------------------------------------------- |
| `Inspector.live`     | real bus: sliding queue of 1024 events; old rows drop when nobody consumes                            |
| `Inspector.disabled` | no-op service, for roots that must provide the tag unconditionally                                    |
| `Inspector.orNoop`   | what emitters use: the service if provided, else a no-op                                              |
| `emit(build)`        | sync and lazy; `build` runs only when a real bus exists, and a throwing builder is logged and dropped |
| `events`             | single-consumer `Stream<InspectorEvent>`                                                              |

## Tapping the transport

`inspectTransport(transportLayer)` decorates any `NostrTransport` layer with the wire events below; it passes through when no `Inspector` is provided. Compose it with `observeTransport` (relay health) in the same place, as in `inspectedServices` above; `linkstrRuntimeAtom` does the same for React.

## Event families

All classes live in `inspector/events.ts`. They fall into three groups:

| Group           | Event                                                                                                 | Fired when                                               |
| --------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Operations      | `OperationSucceeded` (`name`, `params`, `rumorId`, `clientId`, `sentAt`, `selfCopy`, `recipientCopy`) | a wrap vertical finished a send, e.g. `reactions.react`  |
| Operations      | `OperationFailed` (`name`, `params`, `error`)                                                         | any vertical's send failed                               |
| Operations      | `PlainOperationSucceeded` (`name`, `params`, `eventIds`, `result`)                                    | a plain publish, a fetch, `outbox.enqueue`, `outbox.job` |
| Inbox and watch | `InboxRouted` (`wrapId`, `rumorKind`, `delivery`, `event`)                                            | the inbox produced a fact, including `WrapDropped`       |
| Inbox and watch | `InboxWrapDeduped` (`wrapId`)                                                                         | a cross-relay duplicate was skipped                      |
| Inbox and watch | `ProfileWatchRouted` (`eventId`, `kind`, `event`)                                                     | `ProfileWatch` routed or dropped a plain event           |
| Wire            | `WirePublished` (`wrapId`, `wrap`, `results`)                                                         | one signed wrap pushed to the write relays               |
| Wire            | `WirePlainPublished` (`eventId`, `kind`, `event`, `results`)                                          | one signed plain event pushed                            |
| Wire            | `WireSubscribed`, `WireSubscriptionEnded`, `WireEventReceived`                                        | subscription lifecycle and raw arrivals, per relay       |
| Wire            | `WireFetched` (`relay`, `filter`, `events`, `detail`)                                                 | one one-shot fetch answered or failed                    |

Operation and wire rows correlate through shared ids: `OperationSucceeded.selfCopy.wrapId` and `recipientCopy.wrapId` match two `WirePublished.wrapId`s; `rumorId`/`clientId` tie a send to its `InboxRouted` echo and to outbox rows. `InboxRouted.rumorKind` is how an unknown kind shows up before a vertical exists. The web app maps operation and inbox rows onto its `nostr.operation` channel and wire rows onto `nostr.wire` in `apps/web-app/src/devtools/inspector/linkstrRows.ts`.

## The no-key-material rule

The rule: no identity key material in any inspector event, in any field. Not an nsec, not seed words, not a derived `NostrSecretKey`, not inside `params`, `error`, or `event`. Decrypted message content is acceptable by design; the settings copy discloses it.

What is emitted today, so you know what a captured timeline contains:

- `params` is the draft or argument object exactly as the caller passed it. For `chat.sendImage`, and for `outbox.enqueue` / `outbox.job` rows of a queued `chat.image`, that includes `image.key` and `image.nonce`, the attachment's AES-GCM key. `InboxRouted.event` likewise carries a received `ImageBody` with its key. A captured timeline can therefore decrypt attachments, not only read text.
- Identity key material is not emitted anywhere. Telemetry passes `{ draft, recipient }` and keeps the per-attempt signing key out of the event; `WirePublished.wrap` and `WireEventReceived.event` are ciphertext.

Keep it that way when you add an emission point: pass drafts, receipts, ids, and errors, never the identity service or a config object.

## Adding an emission point

Sends already emit through `sendToPeer` / `sendToRecipient` (`inspectOperation`) and plain operations through `inspectPlainOperation`; a new vertical gets both for free by using those skeletons. Event classes are constructed with `disableValidation` so an off-brand field is shown rather than dropped. For anything else, follow the repo skill `.agents/skills/adding-inspector-events/` before adding a class: it covers channel naming, which ids go in `links` versus `context`, wire-format stability, and the glossary entry the viewer needs.

## Related

- [relay-health.md](./relay-health.md) — the production-facing sibling tap
- [react.md](./react.md#relay-health-and-inspector)
- [adding-a-vertical.md](./adding-a-vertical.md)
