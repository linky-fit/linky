/**
 * A token whose mint is unreachable is kept, not lost.
 *
 * The browser cannot reach the local mint, so a pasted token cannot be
 * received. It stays as a deferred receive, shown as a pending amount on the
 * mints page and kept across a reload, and lands in the balance once the
 * mint answers again. A mint that never answers at all is given up on after
 * the receive's time budget: its token is kept the same way, and a token at
 * another mint pasted next still lands.
 *
 * Needs the docker stack up — see playwright.config.ts.
 */
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
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
  targetMintUrl,
} from "../../../packages/linkshu/tests/integration/helpers";
import type { LinkyE2eHooks } from "../src/devtools/e2e/installLinkyE2eHooks";

declare global {
  interface Window {
    __linkyE2E?: LinkyE2eHooks;
  }
}

const TOKEN_SAT = 21;
const OTHER_TOKEN_SAT = 13;

const cutOffMint = (context: BrowserContext) =>
  context.route(`${mintUrl}/**`, (route) => route.abort("connectionrefused"));

/**
 * The requests that load the mint's wallet are never answered, like a
 * half-open connection; the rest pass, so only the wallet load can stall.
 */
const hangMintLoad = (context: BrowserContext) =>
  context.route(`${mintUrl}/**`, (route) =>
    /\/v1\/(info|keys|keysets)/.test(new URL(route.request().url()).pathname)
      ? undefined
      : route.continue(),
  );

const pasteToken = async (page: Page, token: string) => {
  await page.goto("/#wallet/token/new");
  await page.locator("textarea").fill(token);
};

const operationRows = (page: Page) =>
  page.evaluate(async () => {
    if (!window.__linkyE2E) throw new Error("test hooks missing");
    const rows = await window.__linkyE2E.shardRows("cashu", "cashuOperation");
    return rows.map((row) => [row.kind, row.status]);
  });

const mintPending = (page: Page) =>
  page
    .locator(".mint-choice-item", { hasText: new URL(mintUrl).host })
    .locator(".mint-choice-pending");

const openWallet = async (browser: Browser) => {
  const context = await browser.newContext({
    serviceWorkers: "block",
    viewport: { ...MOBILE_VIEWPORT },
  });
  const page = await context.newPage();
  const errors = watchAppErrors(page, "A");
  await setBaseStorage(page);
  await setSeedLoginStorage(page, await createSeedIdentity());
  await stubFiatRates(page);
  await stubThirdPartyAssets(page);
  await page.goto("/#wallet");
  await waitForNetworkReady(page);
  return { context, page, errors };
};

test("a token whose mint is unreachable stays pending until the mint answers", async ({
  browser,
}) => {
  const { context, page, errors } = await openWallet(browser);

  await test.step("a pasted token is kept while the mint is unreachable", async () => {
    const token = await fundToken(TOKEN_SAT);
    await cutOffMint(context);
    await pasteToken(page, token);
    await expect(
      page.getByText("The mint is unreachable. The token is saved"),
    ).toBeVisible();
    await expect
      .poll(() => operationRows(page))
      .toEqual([["deferredReceive", "pending"]]);
  });

  await test.step("the mints page shows it as pending, apart from the balance", async () => {
    await page.goto("/#advanced/mints");
    await expect(mintPending(page)).toHaveText(`${TOKEN_SAT} sat pending`);
    await page.reload();
    await expect(mintPending(page)).toHaveText(`${TOKEN_SAT} sat pending`);
    await page.goto("/#wallet");
    expect(await readBalanceSat(page)).toBe(0);
  });

  await test.step("the token lands in the balance once the mint answers", async () => {
    await context.unroute(`${mintUrl}/**`);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    // Net of the mint's input fee, one sat at most per proof.
    await expect
      .poll(() => readBalanceSat(page), { timeout: 60_000 })
      .toBeGreaterThan(TOKEN_SAT - 3);
    await expect
      .poll(() => operationRows(page))
      .toEqual(
        expect.arrayContaining([
          ["deferredReceive", "done"],
          ["receive", "done"],
        ]),
      );
    await page.goto("/#advanced/mints");
    await expect(
      page.locator(".mint-choice-item", { hasText: new URL(mintUrl).host }),
    ).toContainText(/\d+ sat/);
    await expect(mintPending(page)).toHaveCount(0);
  });

  await expectNoBootErrorPanel(page, "A");
  errors.assertClean();
  await context.close();
});

test("a mint that never answers keeps its token pending and holds up no other mint", async ({
  browser,
}) => {
  const { context, page, errors } = await openWallet(browser);
  const stalledToken = await fundToken(TOKEN_SAT);
  const healthyToken = await fundToken(OTHER_TOKEN_SAT, targetMintUrl);
  await hangMintLoad(context);

  await test.step("a token at the silent mint is kept once the receive gives up on it", async () => {
    await pasteToken(page, stalledToken);
    // The paste page stays busy until the receive's 15 s mint budget runs out.
    await expect(
      page.getByText("The mint is unreachable. The token is saved"),
    ).toBeVisible({ timeout: 45_000 });
    await expect
      .poll(() => operationRows(page))
      .toEqual([["deferredReceive", "pending"]]);
  });

  await test.step("a token at another mint lands while the silent mint still hangs", async () => {
    await pasteToken(page, healthyToken);
    // The paste page opens the token list once the receive is announced;
    // leaving earlier would let that navigation land on top of the next one.
    await expect(page).toHaveURL(/#wallet\/tokens$/, { timeout: 30_000 });
    await expect
      .poll(() => operationRows(page))
      .toEqual(
        expect.arrayContaining([
          ["deferredReceive", "pending"],
          ["receive", "done"],
        ]),
      );
    await page.goto("/#wallet");
    // Net of the mint's input fee, one sat at most per proof.
    expect(await readBalanceSat(page)).toBeGreaterThan(OTHER_TOKEN_SAT - 3);
    await page.goto("/#advanced/mints");
    await expect(mintPending(page)).toHaveText(`${TOKEN_SAT} sat pending`);
  });

  await expectNoBootErrorPanel(page, "A");
  errors.assertClean();
  await context.unrouteAll({ behavior: "ignoreErrors" });
  await context.close();
});
