---
name: running-tests
description: Use whenever you run tests, unit or Playwright e2e.
---

## Unit tests

`bun run test` runs Vitest in every workspace; `bun run --filter <package> test` runs one.

Keep the loop tight while iterating, from inside the workspace you changed:

- `bunx vitest related <changed files> --run` runs every test that imports those files, directly or transitively. Name the test files instead when you know them.
- `bun run typecheck` checks that workspace's types; keep `check-changed` for the end.

Run `bun run test-changed` once before you commit. It covers the workspaces the branch reaches, the same scope as `check-changed`.

## E2E tests

Run every Playwright suite through `bun run e2e`. It starts a Docker stack owned by this checkout, on ports derived from its path, so other worktrees can run e2e at the same time. It passes `--build` every run; layer caching turns that into a no-op unless app code changed, and editing specs never triggers a rebuild.

- `bun run e2e tests/<name>.spec.ts` runs the specs your change touches. Run them before you commit a change to a flow Playwright covers; the full suite runs on CI for every pull request that reaches web-app, site or shared code. Changes confined to other apps need no e2e run.
- Add `-x` while iterating, so the run stops at the first failure.
- After a failure, `bun run e2e --last-failed` reruns only the failed tests.
- `bun run e2e site` runs the site suite against the same stack.
- `bun run e2e down` stops the stack and drops its data. Run it when the task is done; every running stack holds memory in the shared Docker VM.
- If `up` fails with "port is already allocated", another checkout hashed to the same ports: rerun with `LINKY_E2E_SLOT=<1-100>`.

Traces are kept only for failing tests: `bunx playwright show-trace apps/web-app/test-results/<test>/trace.zip`.

The full web-app suite takes about five minutes on CI. A test that runs into the 150 s test timeout is hanging: find the wait that never resolves and leave the timeouts as they are.

Specs take stack endpoints from `apps/web-app/tests/helpers/stack.ts` and the mint URLs from `packages/linkshu/tests/integration/helpers.ts`; a literal `localhost` port only works on CI's default stack.
