# @linky-fit/linkshu

The docs in `docs/` and `README.md` ship in the npm tarball for external consumers; `src/` does not. Read the guide for a vertical before changing it.

## Keep the docs in sync

A change to anything exported from `src/index.ts` or to behavior a guide describes lands only with the matching `docs/*.md` (and the "Which operation fails how" table in `docs/errors.md`) updated in the same commit: snippets typecheck against the new surface, every named field and error tag exists, a new vertical or port gets its own guide linked from `docs/README.md`. Guides name exported symbols, never `src/` paths.

## Tests

- Unit: `src/**/*.test.ts`, `bun run --filter @linky-fit/linkshu test` (part of the root `bun run test`). Vitest with globals.
- Integration: `tests/integration/*.test.ts`, public API only, against the two dev-stack mints (`docker compose -f docker-compose.dev.yml up -d --wait cashu-mint cashu-mint-target`, then `bun run --filter @linky-fit/linkshu test:integration`). Override the mints with `LINKSHU_MINT_URL` / `LINKSHU_TARGET_MINT_URL`. Helpers in `tests/integration/helpers.ts` (`durableStorage`, `fundToken`, `invoiceFor` from the target mint, `claimExternally`, `inputFee`, `randomSeed`). CI job: `linkshu-integration`.

## Unit harness

`src/testing/` is package-internal (excluded from the build, not exported): `fakeWallet(overrides)`, `proof`, `answerProofStates`, `recordingInspector()` (`{ events, service, layer }`), `seedProofs`/`seedTransfer`/`proofsIn`/`amountIn`/`secretsOf`, `freshStorage()` (stores that outlive one runtime), `runOnTestClock(program, step)` (needs `TestContext.TestContext`). A vertical's test provides `Service.DefaultWithoutDependencies` over `Layer.succeed(WalletInstances, WalletInstances.make({ get: () => Effect.succeed(fakeWallet({...})) }))`, the in-memory ports, and `recordingInspector().layer` (pattern: `src/receive/Receive.test.ts`), and asserts on `inspector.events.map((e) => e._tag)`.

## Emitting inspector events from a new vertical

Wrap the public operation in `inspectOperationWith(inspector, name, params, redactResult)` from `src/internal/operations.ts`; it emits `OperationSucceeded`/`OperationFailed` without altering the outcome. `redactResult` strips anything a holder could spend: pass `redactReceipt` for anything carrying `tokenText` or `proofs`, `inspectOperation` when the result is already safe. Proof, operation, and counter events come from `insertProofs`/`setProofState` (`src/internal/proofs.ts`), `insertOperation`/`patchOperation`, and `advanceCounterTo`; pass a `reason` that names your step and add it to the `reason` list in `docs/inspector.md`. Events are constructed with `disableValidation: true` so a bad field surfaces in the consumer, not as a failed wallet operation.

## Rules

Environment-agnostic (no React, Evolu, `window`, `localStorage`; `apps/linkshu-cli` runs the package on plain Bun and keeps this honest), no raw cashu-ts types in the public API, no dependency edge to `@linky-fit/linkstr` in either direction.
