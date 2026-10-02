---
name: running-tests
description: Use whenever you run tests, unit or Playwright e2e.
---

## Unit tests

`bun run test` runs Vitest in every workspace; `bun run --filter <package> test` runs one.

## E2E tests

Run every Playwright suite through `bun run e2e`. It starts a Docker stack owned by this checkout, on ports derived from its path, so other worktrees can run e2e at the same time. It passes `--build` every run; layer caching turns that into a no-op unless app code changed, and editing specs never triggers a rebuild.

- `bun run e2e tests/<name>.spec.ts` runs the specs your change touches. Start there, then run the full suite (`bun run e2e`) before you commit a change to a flow Playwright covers.
- Add `-x` while iterating, so the run stops at the first failure.
- After a failure, `bun run e2e --last-failed` reruns only the failed tests.
- `bun run e2e site` runs the site suite against the same stack.
- `bun run e2e down` stops the stack and drops its data. Run it when the task is done; every running stack holds memory in the shared Docker VM.
- If `up` fails with "port is already allocated", another checkout hashed to the same ports: rerun with `LINKY_E2E_SLOT=<1-100>`.

Traces are kept only for failing tests: `bunx playwright show-trace apps/web-app/test-results/<test>/trace.zip`.

The full web-app suite takes about two minutes. A test that runs into the 150 s test timeout is hanging: find the wait that never resolves and leave the timeouts as they are.

Specs take stack endpoints from `apps/web-app/tests/helpers/stack.ts` and the mint URLs from `packages/linkshu/tests/integration/helpers.ts`; a literal `localhost` port only works on CI's default stack.
