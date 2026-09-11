# Inspector

The optional diagnostics bus: how to switch it on, what it emits, and how the CLI and web app consume it. You need this when debugging a wallet flow, adding a consumer, or emitting from a new vertical.

## What it is

`Inspector` (`src/inspector/Inspector.ts`) is a `Context.Tag` with two members:

| Member        | Type                                           | Notes                                                                                              |
| ------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `emit(build)` | `(build: () => LinkshuInspectorEvent) => void` | Sync and total. The builder runs lazily; a throwing builder is logged and dropped, never a defect. |
| `events`      | `Stream.Stream<LinkshuInspectorEvent>`         | Single consumer; fan out downstream if you need more.                                              |

Verticals resolve it with `Inspector.orNoop`, so a runtime without the layer pays one no-op call per event.

## Providing it

Three layers ship with the package:

| Layer                | Use                                                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------------------- |
| `Inspector.live`     | Sliding in-memory queue (1024 events); consume `events` as a stream. Scoped, so it needs a scope/runtime.  |
| `Inspector.disabled` | No-op service, for composition roots that provide the tag unconditionally.                                 |
| your own             | `Layer.succeed(Inspector, { emit, events: Stream.empty })` — a callback sink; what both real consumers do. |

The layer must sit **around** the services layer, because services read the inspector while the layer is being built. `runLinkshu` does this for you through its `inspector` option:

```ts
import { Inspector, runLinkshu, Tokens } from "@linky/linkshu";
import type { Bip39Seed } from "@linky/linkshu";
import { Effect } from "effect";

const balancesWithInspector = (bip39Seed: Bip39Seed) =>
  runLinkshu(
    { bip39Seed, inspector: Inspector.live },
    Effect.flatMap(Tokens, (tokens) => tokens.balances),
  );
```

With `linkshuServices`, provide-merge it onto the services layer:

```ts
import { Inspector, linkshuServices } from "@linky/linkshu";
import type { Bip39Seed } from "@linky/linkshu";
import { Layer } from "effect";

const inspectedServices = (bip39Seed: Bip39Seed) =>
  linkshuServices({ bip39Seed }).pipe(Layer.provideMerge(Inspector.live));
```

## Subscribing

A callback sink is the simplest consumer and needs no stream plumbing:

```ts
import { Inspector } from "@linky/linkshu";
import type { LinkshuInspectorEvent } from "@linky/linkshu";
import { Layer, Stream } from "effect";

export const consoleInspector = (
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

To consume `Inspector.live` as a stream, fork the consumer in a runtime that has the layer, and stop it before the runtime goes away:

```ts
import { Inspector, linkshuServices } from "@linky/linkshu";
import type { Bip39Seed } from "@linky/linkshu";
import { Effect, Fiber, Layer, ManagedRuntime, Stream } from "effect";

export const startInspectedWallet = (bip39Seed: Bip39Seed) => {
  const runtime = ManagedRuntime.make(
    linkshuServices({ bip39Seed }).pipe(Layer.provideMerge(Inspector.live)),
  );

  const consumer = runtime.runFork(
    Effect.flatMap(Inspector, (inspector) =>
      Stream.runForEach(inspector.events, (event) =>
        Effect.sync(() => console.log(event._tag)),
      ),
    ),
  );

  const shutdown = async () => {
    await Effect.runPromise(Fiber.interrupt(consumer));
    await runtime.dispose();
  };

  return { runtime, shutdown };
};
```

Call `shutdown` at application exit. Disposing the runtime also closes the queue behind `Inspector.live`, so events emitted after that are dropped.

## Event families

All in `src/inspector/events.ts`; `LinkshuInspectorEvent` is their union.

| Tag                  | Fields                                                                               | Emitted when                                                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OperationSucceeded` | `name`, `params`, `result`                                                           | A public operation finished.                                                                                                                                   |
| `OperationFailed`    | `name`, `params`, `error`                                                            | An operation or subscription attempt failed with a typed error (the tagged error object is `error`).                                                           |
| `ProofsChanged`      | `mint`, `count`, `amount`, `from`, `to`, `operationId`, `reason`                     | A batch of proofs was stored (`from: null`) or moved between states; one row per batch and source state. Counts and amounts only.                              |
| `OperationChanged`   | `operationId`, `kind`, `from`, `to`, `reason`                                        | An operation was inserted (`from: null`) or changed status.                                                                                                    |
| `CounterAdvanced`    | `mint`, `unit`, `keysetId`, `from`, `to`, `reason`                                   | A deterministic counter moved; `reason` is `used`, `collision-recovery`, or `restore`.                                                                         |
| `QuoteStateChanged`  | `flow`, `quoteId`, `mint`, `state`, `via`                                            | A mint/melt quote was observed in a new state while `topup`, `autoswap`, or `melt` watched it; `via` names the watcher (`poll`, or the NUT-17 `subscription`). |
| `LightningFeeProbed` | `mint`, `probeMint`, `meltQuoteId`, `mintQuoteId`, `amount`, `feeReserve`, `percent` | A fee probe measured a mint's Lightning fee.                                                                                                                   |

Operation `name` is `<vertical>.<method>` in camelCase, matching the service and method you called: `receive.receive`, `topup.resumePending`. One operation usually produces several rows — a `send.send` is bracketed by the `CounterAdvanced`, `OperationChanged`, and `ProofsChanged` rows it caused. `melt.resumePending` emits one `melt.resume` row per pending melt (params `mint`, `quoteId`, `operationId`; `OperationFailed` when the mint gave no usable answer) before its own summary row.

`reason` on `ProofsChanged`/`OperationChanged` names the step that caused the change: the operation (`receive`, `send`, `melt`, `topup`, `autoswap`, `restore`, `returnToWallet`, `import`, `legacy-ingest`), a sub-step (`send-change`, `melt-keep`, `melt-change`, `melt-paid`, `melt-unpaid`, `melt-rejected`), a `Tokens` transition (`markIssued`, `markExternalized`, `forget`), or a validation outcome (`validation`, `claimed`, `check`). Quote operations report their record steps as `<kind>-record` (inserted), `attempt` (counter slot written), and `<kind>-<status>` (settled).

`topup.subscribe` is an internal subscription attempt: an `OperationFailed` row records a setup failure or socket close before retrying. Its params contain only `mint` and `quoteId`; normal cancellation emits no failure, and settlement appears as `QuoteStateChanged` with `via: "subscription"`.

Correlate rows by `operationId`: it links every `ProofsChanged` and `OperationChanged` row of one flow to the `OperationSucceeded`/`OperationFailed` row whose `result` or `params` carries the same id (receipts, resume results, and the `Tokens` transitions all name it). `quoteId` links quote-state changes to a topup, autoswap, or melt. `ProofsChanged` with `operationId: null` is balance moving (change, restored proofs, spent-marking by a pre-check or validation); its `reason` says which flow.

## What events never contain

No event carries seed material or proof secrets. Token text _is_ proof secrets, so receipts arrive without their `tokenText` and `proofs`, `receive.receive` has empty `params`, melt and fee-probe params carry the mint but not the invoice, and a `QuoteLockingKey` never appears. Everything else — mint urls, amounts, quote ids, operation ids, tagged errors — is in the clear; treat a persisted event log as sensitive metadata, not as secrets.

## Consumers in the repo

- **CLI** (`apps/linkshu-cli/src/stderrInspector.ts`): `--verbose` provides a layer that writes `[linkshu] <Tag> {…fields}` per event to stderr, so stdout stays the command's result (`send` prints the bare token). Try it: `bun run linkshu --verbose --data-dir /tmp/wallet balance`.
- **Web app** (`apps/web-app/src/devtools/inspector/linkshuInspector.ts`): a layer that maps each event to one `cashu`-channel row for the app inspector, gated per event on the inspector setting. Open `#advanced/inspector/timeline` or the standalone `inspector.html` in dev to watch it.

For tests, `recordingInspector()` from `src/testing/inspector.ts` collects events into an array; see [testing.md](./testing.md).

## Emitting from a new vertical (contributors)

Wrap the public operation in `inspectOperationWith(inspector, name, params, redactResult)` from `src/internal/operations.ts`; it emits `OperationSucceeded`/`OperationFailed` without altering the outcome. `redactResult` must strip anything a holder could spend — pass `redactReceipt` for anything carrying `tokenText` or `proofs`. `inspectOperation` is the shorthand when the result is already safe. Proof, operation, and counter events come for free from `insertProofs`/`setProofState` (`src/internal/proofs.ts`), `insertOperation`/`patchOperation` (`src/internal/operations.ts`), and `advanceCounterTo`; pass a `reason` that names your step.

Events are constructed with `disableValidation: true` so a bad field surfaces in the consumer, not as a failed wallet operation. Assert on `recordingInspector().events` in the vertical's unit test.

## Related

- [errors.md](./errors.md) — the tagged errors `OperationFailed` carries
- [concepts.md](./concepts.md) — proof states, operation statuses, and counter reasons the events describe
- [testing.md](./testing.md) — asserting on emitted events
