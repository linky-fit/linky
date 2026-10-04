---
name: writing-tests
description: Picks the test layer and shape for a change. Use whenever you add or change behavior that needs a test, or add, move or delete a test.
---

# Writing tests

Test each behavior at the lowest layer that goes red when it breaks. Each layer up costs roughly a thousand times more run time and flakes more, so the e2e suite holds only what no lower layer can catch.

## Layers

| Layer                | Lives in                                                                           | Catches                                                                                                                                                       |
| -------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Package unit         | `packages/*/src/**/*.test.ts`                                                      | Everything a package owns: domain rules, state transitions, wire shapes, sync and shard logic. Use the package's fakes from `src/testing/`.                   |
| App unit / component | `apps/web-app/src/**/*.test.ts(x)` (jsdom, `src/testUtils/renderIntoDocument.tsx`) | Hooks, scheduling, what a screen shows and allows for given props: validation, confirmations, prefills, error branches. Time-based behavior uses fake timers. |
| Mint integration     | `packages/linkshu/tests/integration`                                               | Cashu operations against a real mint: fees, collisions, restarts, envelopes.                                                                                  |
| E2E                  | `apps/web-app/tests`, `apps/site/tests` (Playwright on the Docker stack)           | The wiring between real pieces, listed below.                                                                                                                 |

An e2e test earns its place only by covering wiring that lives between real pieces:

- two or more devices converging through the Evolu relay
- messages and payments crossing a real Nostr relay or mint from the UI
- boot, storage and recovery in a real browser (OPFS, SQLite WASM, service worker, Web Locks)
- what the served production build sends (headers, CSP)

## Steps

1. Write the unit test first, at the layer from the table. Every edge case, error branch and input combination goes here.
2. Add e2e coverage only when the change touches the wiring listed above. Prefer a new `test.step` in an existing spec's flow over a new test, because every new test pays a cold boot of each account it uses. Cover the happy path once and leave its branches to step 1.
3. Before you delete or move an e2e test, open the lower-layer test that replaces it and confirm it asserts the same behavior. If none does, write it first.

Done when every branch of the change is asserted at some layer and any e2e addition traces back to an item in the wiring list.

## E2E shape

- **Observable waits.** Wait on state the app exposes, using `expect`, `expect.poll` or `toPass`. Lint rejects `waitForTimeout`; the one exception is asserting that nothing happens, which keeps an `eslint-disable-next-line` with its reason.
- **No real-time waits.** Make due dates and deadlines arrive through data, using the `VITE_E2E` hooks in `apps/web-app/src/devtools/e2e/`. Keep the browser clock real, because relays reject future Nostr events and Evolu bounds clock drift.
- **Fewest accounts.** Boot only the accounts the flow needs, each with a fresh `createSeedIdentity()`. That keeps tests independent, so the suite runs `fullyParallel`.
- **One variant per code path.** Parametrize over cases that take different branches; a matrix of combinations belongs in a unit test.
