# Relay health

`RelayHealth` is an always-on, per-relay connection status folded from the traffic linkstr actually produces; nothing is probed. You need it for any "is this relay working" UI, and you need `observeTransport` in a composition root that wants the snapshot filled. EOSE, the relay's end-of-stored-events marker, is defined in [concepts.md](./concepts.md#vocabulary).

## What a snapshot holds

`RelayHealthSnapshot` is `ReadonlyMap<RelayUrl, RelayHealthState>`:

| Field         | Meaning                                                                      |
| ------------- | ---------------------------------------------------------------------------- |
| `state`       | `"connecting"` \| `"connected"` \| `"unreachable"`                           |
| `detail`      | last close or error reason; meaningful while `unreachable`                   |
| `lastSeenAt`  | last proof the relay served us (event, EOSE, fetch result, accepted publish) |
| `lastErrorAt` | last failure timestamp                                                       |
| `lastPublish` | `{ at, accepted, detail }` of the most recent publish, or null               |

A relay appears in the map only after some traffic touched it. Write-only relays may never subscribe, so their freshest signal is `lastPublish`; show its timestamp.

## Transitions

| Traffic                                              | Effect on state                                                                                |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| subscribe attempt starts                             | `connecting` (unless already `connected`)                                                      |
| event received, EOSE, fetch result                   | `connected`, `detail` cleared, `lastSeenAt` updated                                            |
| accepted publish                                     | `connected` plus `lastPublish`                                                                 |
| rejected publish                                     | only `lastPublish` and `lastErrorAt`; state untouched (a policy rejection is not a dead relay) |
| subscription ended, `RelayUnreachable`, fetch failed | `unreachable` with the reason                                                                  |

The verticals' resubscribe loops (exponential backoff from a 5s base, capped at 12×, jittered) flip an unreachable relay back to `connecting` on the next attempt. Value-equal transitions are skipped, so a flood costs at most one write per relay per second.

## Composing it

`observeTransport` is a transparent tap over any `NostrTransport` layer. It reports to `RelayHealth` when that service is present and passes through otherwise.

```ts
import { Layer } from "effect";
import {
  inspectTransport,
  linkstrServices,
  NostrTransportSimplePool,
  observeTransport,
  RelayHealth,
} from "@linky/linkstr";

const services = linkstrServices({
  secretKey,
  readRelays,
  writeRelays,
  transport: inspectTransport(observeTransport(NostrTransportSimplePool)),
}).pipe(Layer.provideMerge(RelayHealth.live));
```

This is what the linkstr-react runtime does. Both taps wrap the same raw transport; order does not matter for correctness. `runLinkstr` composes neither, so headless runs have an empty snapshot.

## Reading it in Effect

```ts
import { Effect, Stream } from "effect";
import { RelayHealth } from "@linky/linkstr";

const logHealth = Effect.gen(function* () {
  const health = yield* RelayHealth;
  const now = yield* health.current;
  console.log([...now.entries()]);
  yield* Stream.runForEach(health.changes, (snapshot) =>
    Effect.sync(() => console.log("changed", snapshot.size)),
  );
});
```

`current` is the snapshot; `changes` emits the current snapshot on subscription and again on every change.

## Reading it in React

`relayHealthAtom` mirrors `changes` as a `Result<ReadonlyMap<string, RelayHealthState>>`, keyed by plain string so UI code can look up its own relay list. It resets when the runtime is rebuilt.

```tsx
import type { RelayHealthState } from "@linky/linkstr";
import { relayHealthAtom, Result, useAtomValue } from "@linky/linkstr-react";

const EMPTY: ReadonlyMap<string, RelayHealthState> = new Map();

export const useRelayHealth = () => {
  const result = useAtomValue(relayHealthAtom);
  return Result.isSuccess(result) ? result.value : EMPTY;
};

export const RelayDot = ({ url }: { url: string }) => {
  const state = useRelayHealth().get(url)?.state ?? "connecting";
  return <span className={`relay-dot relay-dot-${state}`} title={url} />;
};
```

The web app's `app/hooks/useRelayHealth.ts` adds `relayDotState`, `countConnectedRelays`, and `overallRelayStatus` on top of this map; treat a missing entry as "checking".

## Related

- [inspector.md](./inspector.md) — the sibling tap and how the two compose
- [react.md](./react.md) — the runtime that wires both
