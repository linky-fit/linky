# Inspector

The optional diagnostics bus: how to switch it on, what it emits, and how to consume it.

## What it is

`Inspector` is a `Context.Tag` with two members: `emit(build: () => LinkshuInspectorEvent): void`, sync and total (the builder runs lazily; a throwing builder is logged and dropped, never a defect), and `events: Stream<LinkshuInspectorEvent>`, single-consumer. Services resolve it with `Inspector.orNoop`, so a runtime without the layer pays one no-op call per event.

## Providing it

| Layer                | Use                                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------------------- |
| `Inspector.live`     | Sliding in-memory queue (1024 events); consume `events` as a stream. Scoped, so it needs a scope/runtime. |
| `Inspector.disabled` | No-op service, for composition roots that provide the tag unconditionally.                                |
| your own             | `Layer.succeed(Inspector, { emit, events: Stream.empty })`: a callback sink.                              |

The layer must sit around the services layer, because services read the inspector while the layer is being built. `runLinkshu` does this through its `inspector` option; with `linkshuServices`, provide-merge it:

```ts
import {
  Inspector,
  linkshuServices,
  runLinkshu,
  Tokens,
} from "@linky-fit/linkshu";
import { Effect, Layer } from "effect";

const oneShot = runLinkshu(
  { bip39Seed, inspector: Inspector.live },
  Effect.flatMap(Tokens, (tokens) => tokens.balances),
);

const inspectedServices = linkshuServices({ bip39Seed }).pipe(
  Layer.provideMerge(Inspector.live),
);
```

## Subscribing

A callback sink is the simplest consumer and needs no stream plumbing:

```ts
import { Inspector } from "@linky-fit/linkshu";
import type { LinkshuInspectorEvent } from "@linky-fit/linkshu";
import { Layer, Stream } from "effect";

export const callbackInspector = (
  onEvent: (event: LinkshuInspectorEvent) => void,
): Layer.Layer<Inspector> =>
  Layer.succeed(Inspector, {
    emit: (build) => {
      try {
        onEvent(build());
      } catch (error) {
        console.warn("linkshu inspector emission failed", error);
      }
    },
    events: Stream.empty,
  });
```

Keep the `try/catch`: `emit` is total by contract, and your sink is part of it.

To consume `Inspector.live` as a stream, fork `Stream.runForEach(inspector.events, …)` in a runtime that has the layer (`runtime.runFork`), and interrupt that fiber before disposing the runtime. Disposing the runtime closes the queue, so events emitted after that are dropped.

## Event families

`LinkshuInspectorEvent` is the union of:

| Tag                  | Emitted when                                                                                                                      |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `OperationSucceeded` | A public operation finished.                                                                                                      |
| `OperationFailed`    | An operation or subscription attempt failed with a typed error (the tagged error object is `error`).                              |
| `ProofsChanged`      | A batch of proofs was stored (`from: null`) or moved between states; one row per batch and source state. Counts and amounts only. |
| `OperationChanged`   | An operation was inserted (`from: null`) or changed status.                                                                       |
| `CounterAdvanced`    | A deterministic counter moved; `reason` is `used`, `collision-recovery`, or `restore`.                                            |
| `QuoteStateChanged`  | A mint/melt quote was observed in a new state by `topup`, `autoswap`, or `melt`; `via` is `poll` or the NUT-17 `subscription`.    |
| `LightningFeeProbed` | A fee probe measured a mint's Lightning fee.                                                                                      |

Operation `name` is `<vertical>.<method>` in camelCase, matching the service and method you called (`receive.receive`, `topup.resumePending`). One operation usually produces several rows; a `send.send` is bracketed by the `CounterAdvanced`, `OperationChanged`, and `ProofsChanged` rows it caused. Some operations emit per-item rows before their summary: `melt.resumePending` emits one `melt.resume` per pending melt (`OperationFailed` when the mint gave no usable answer), `receive.resumeDeferred` one `receive.resume` per deferral it attempts (its result is the deferral's `received` or `pending` outcome, `OperationFailed` with the receive error for any other; the summary's result says what became of each deferral), `tokens.reclaim` one `tokens.reclaimMint` per mint attempt with the proof and operation ids involved, a resumed receive one `receive.restoreAttempt` with the mint, operation id, and recorded slot (its result counts the restored proofs), and `topup.subscribe` records a subscription setup failure or socket close before a retry.

`reason` on `ProofsChanged`/`OperationChanged` names the step that caused the change: the operation (`receive`, `send`, `melt`, `topup`, `autoswap`, `restore`, `returnToWallet`, `reclaim`, `adopt`, `import`, `legacy-ingest`), a sub-step (`send-change`, `melt-keep`, `melt-change`, `melt-paid`, `melt-unpaid`, `melt-rejected`, `melt-late-input` for an input that synced in after its melt closed), a `Tokens` transition, a validation outcome (`validation`, `claimed`, `check`), an envelope step (`envelope` for funding it, `envelope-change` for that swap's change and inputs, `envelope-adopt` for storing one another device funded or a melt names, `envelope-reconcile` for storing proof rows its operation names but this device lacks, or re-holding its rows whose holder never synced, `envelope-send`, `envelope-spent` when the mint reports its proofs spent, `envelope-release`), or `deferred-receive` (a `deferredReceive` kept for a mint that would not load or answer, handed to the receive that recorded its token, or closed by `resumeDeferred`). Quote operations report `<kind>-record` (inserted), `attempt` (counter slot written), and `<kind>-<status>` (settled).

Correlate rows by `operationId`: it links every `ProofsChanged` and `OperationChanged` row of one flow to the `OperationSucceeded`/`OperationFailed` row whose `result` or `params` carries the same id. `quoteId` links quote-state changes to a topup, autoswap, or melt. `ProofsChanged` with `operationId: null` is balance moving (change, restored proofs, spent-marking by a pre-check or validation); its `reason` says which flow.

## What events never contain

No event carries seed material or proof secrets. Token text is proof secrets, so receipts arrive without their `tokenText` and `proofs`, `receive.receive` and `tokens.adoptToken` have empty `params`, melt and fee-probe params carry the mint but not the invoice, `envelope.send` results drop the token text, and a `QuoteLockingKey` never appears. Everything else (mint urls, amounts, quote ids, operation ids, envelope keys, tagged errors) is in the clear; treat a persisted event log as sensitive metadata.

## Related

- [errors.md](./errors.md): the tagged errors `OperationFailed` carries
- [concepts.md](./concepts.md): proof states, operation statuses, and counter reasons the events describe
