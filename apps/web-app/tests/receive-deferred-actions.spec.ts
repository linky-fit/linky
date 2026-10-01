/**
 * A token waiting for an unreachable mint is visible on the wallet page and
 * can be given up on.
 *
 * The browser cannot reach the local mint, so a pasted token is kept as a
 * deferred receive. The wallet page shows it as pending next to the balance;
 * its mint's page copies the token text and, after a warning, discards it,
 * which removes the pending line.
 *
 * Needs the docker stack up — see playwright.config.ts.
 */
import { expect, test, type Page } from "@playwright/test";
import {
  MOBILE_VIEWPORT,
  readBalanceSat,
  setBaseStorage,
  waitForNetworkReady,
} from "./helpers/appState";
import { expectNoBootErrorPanel, watchAppErrors } from "./helpers/diagnostics";
import { createSeedIdentity, setSeedLoginStorage } from "./helpers/identity";
import { stubFiatRates, stubThirdPartyAssets } from "./helpers/network";
import {
  fundToken,
  mintUrl,
} from "../../../packages/linkshu/tests/integration/helpers";
import type { LinkyE2eHooks } from "../src/devtools/e2e/installLinkyE2eHooks";

declare global {
  interface Window {
    __linkyE2E?: LinkyE2eHooks;
  }
}

const TOKEN_SAT = 21;

const operationRows = (page: Page) =>
  page.evaluate(async () => {
    if (!window.__linkyE2E) throw new Error("test hooks missing");
    const rows = await window.__linkyE2E.shardRows("cashu", "cashuOperation");
    return rows.map((row) => [row.kind, row.status]);
  });

/** Replaces setBaseStorage's no-op clipboard with one that keeps the text. */
const recordClipboard = (page: Page) =>
  page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          Reflect.set(window, "e2eClipboard", text);
        },
      },
    });
  });

const copiedText = (page: Page) =>
  page.evaluate(() => Reflect.get(window, "e2eClipboard"));

test("a token waiting for its mint shows on the wallet page and can be discarded", async ({
  browser,
}) => {
  const context = await browser.newContext({
    serviceWorkers: "block",
    viewport: { ...MOBILE_VIEWPORT },
  });
  const page = await context.newPage();
  const errors = watchAppErrors(page, "A");
  await setBaseStorage(page);
  await recordClipboard(page);
  await setSeedLoginStorage(page, await createSeedIdentity());
  await stubFiatRates(page);
  await stubThirdPartyAssets(page);
  await page.goto("/#wallet");
  await waitForNetworkReady(page);

  const token = await fundToken(TOKEN_SAT);
  const pendingLine = page.locator("button.wallet-pending");

  await test.step("a token pasted while the mint is unreachable shows as pending on the wallet page", async () => {
    await context.route(`${mintUrl}/**`, (route) =>
      route.abort("connectionrefused"),
    );
    await page.goto("/#wallet/token/new");
    await page.locator("textarea").fill(token);
    await expect(
      page.getByText("The mint is unreachable. The token is saved"),
    ).toBeVisible();
    await page.goto("/#wallet");
    await expect(pendingLine).toHaveText(`${TOKEN_SAT} sat pending`);
    expect(await readBalanceSat(page)).toBe(0);
  });

  await test.step("the pending line opens the mint, which copies the token text", async () => {
    await pendingLine.click();
    await expect(page.getByText("Waiting for the mint")).toBeVisible();
    await page.getByRole("button", { name: "Copy token" }).click();
    await expect.poll(() => copiedText(page)).toBe(token);
  });

  await test.step("discarding asks first, then closes the deferral", async () => {
    await page.getByRole("button", { name: "Discard" }).click();
    const warning = page.getByRole("dialog", { name: "Discard this token?" });
    await expect(warning).toContainText(`${TOKEN_SAT} sat was never received`);
    await warning.getByRole("button", { name: "Discard" }).click();
    await expect(warning).toHaveCount(0);
    await expect(page.getByText("Waiting for the mint")).toHaveCount(0);
    await expect
      .poll(() => operationRows(page))
      .toEqual([["deferredReceive", "done"]]);
  });

  await test.step("the wallet page no longer shows anything pending", async () => {
    await page.goto("/#wallet");
    expect(await readBalanceSat(page)).toBe(0);
    await expect(pendingLine).toHaveCount(0);
  });

  await expectNoBootErrorPanel(page, "A");
  errors.assertClean();
  await context.close();
});
