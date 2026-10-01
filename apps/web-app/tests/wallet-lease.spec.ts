/**
 * Two tabs of the app never hold the same wallet lease at once.
 *
 * The lease guards the deterministic counters and a mint's receives across
 * tabs. Both tabs claim the same key at the same instant, many times over;
 * exactly one may win each round.
 *
 * Needs the docker stack up — see playwright.config.ts.
 */
import { expect, test, type Page } from "@playwright/test";
import type { LinkyE2eHooks } from "../src/devtools/e2e/installLinkyE2eHooks";

declare global {
  interface Window {
    __linkyE2E?: LinkyE2eHooks;
  }
}

const ROUNDS = 40;
/** Far enough ahead that both tabs are waiting before the claim starts. */
const START_DELAY_MS = 300;

const claimAt = (page: Page, key: string, at: number) =>
  page.evaluate(
    async ({ key, at }) => {
      const hooks = window.__linkyE2E;
      if (!hooks) throw new Error("test hooks missing");
      while (Date.now() < at) {
        // Spin so both tabs claim within the same millisecond.
      }
      return hooks.tryAcquireLease(key, 60_000);
    },
    { key, at },
  );

test("two tabs racing for one wallet lease never both hold it", async ({
  browser,
}) => {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const tabs = [await context.newPage(), await context.newPage()];
  for (const tab of tabs) {
    await tab.goto("/");
    await expect
      .poll(() => tab.evaluate(() => window.__linkyE2E !== undefined))
      .toBe(true);
  }

  const doubleClaims: number[] = [];
  for (let round = 0; round < ROUNDS; round += 1) {
    const key = `linkshu.e2e.race.${round}`;
    const at = Date.now() + START_DELAY_MS;
    const leases = await Promise.all(tabs.map((tab) => claimAt(tab, key, at)));
    const winners = leases.filter((lease) => lease !== null).length;
    expect(winners, `round ${round}`).toBeGreaterThan(0);
    if (winners > 1) doubleClaims.push(round);
  }
  expect(doubleClaims, "rounds both tabs won").toEqual([]);

  await context.close();
});
