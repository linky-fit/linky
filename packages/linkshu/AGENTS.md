# @linky-fit/linkshu

`docs/` and `README.md` ship in the npm tarball for external consumers; `src/` does not. Read the guide for a vertical before changing it.

## Keep the docs in sync

The guides count as in sync when every snippet typechecks against `src/index.ts`, every named field and error tag exists, and a new vertical or port has its own guide linked from `docs/README.md`.

## Tests

- Unit: `src/**/*.test.ts`, vitest with globals. `src/testing/` holds the harness (fake wallet, recording inspector, in-memory storage that outlives one runtime, test clock); it is package-internal, excluded from the build and never exported. A vertical's test provides `Service.DefaultWithoutDependencies` over a `WalletInstances` layer wrapping `fakeWallet`, the in-memory ports, and `recordingInspector().layer`, then asserts on the recorded event tags; copy `src/receive/Receive.test.ts`.
- Integration: `tests/integration/*.test.ts`, public API only, against the two dev-stack mints (`docker compose -f docker-compose.dev.yml up -d --wait cashu-mint cashu-mint-target`, then `bun run --filter @linky-fit/linkshu test:integration`). Override the mints with `LINKSHU_MINT_URL` / `LINKSHU_TARGET_MINT_URL`.

## Emitting inspector events from a new vertical

Wrap the public operation in `inspectOperationWith(inspector, name, params, redactResult)` from `src/internal/operations.ts`; it emits `OperationSucceeded`/`OperationFailed` without altering the outcome. `redactResult` strips anything a holder could spend: pass `redactReceipt` for a result carrying `tokenText` or `proofs`, `inspectOperation` when the result is already safe. Proof, operation, and counter events come from `insertProofs`/`setProofState` (`src/internal/proofs.ts`), `insertOperation`/`patchOperation`, and `advanceCounterTo`; pass a `reason` that names your step and add it to the `reason` list in `docs/inspector.md`. Events are constructed with `disableValidation: true` so a bad field surfaces in the consumer, not as a failed wallet operation.

## Rules

Environment-agnostic (no React, Evolu, `window`, `localStorage`; `apps/linkshu-cli` runs the package on plain Bun and keeps this honest), no raw cashu-ts types in the public API, no dependency edge to `@linky-fit/linkstr` in either direction. No key material is stored: NUT-20 locking keys are arguments to `adopt`/`resumePending`, and `submitLnurlAuth` takes a `sign` callback.
