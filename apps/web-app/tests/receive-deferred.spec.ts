/**
 * A token whose mint is unreachable is kept, not lost.
 *
 * The browser cannot reach the local mint, so a pasted token is kept as a
 * deferred receive, shown as pending on the wallet and mints pages and kept
 * across a reload. Its mint's page copies the token text and, after a
 * warning, discards it; a token that is not discarded lands in the balance
 * once the mint answers again. Another device of the same wallet that has
 * synced a discard and then replays the chat message carrying the token
 * leaves it discarded, whether its mint is down or up.
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
  readBalanceSat,
  MOBILE_VIEWPORT,
  setBaseStorage,
  waitForNetworkReady,
} from "./helpers/appState";
import { addContactByNpub } from "./helpers/contacts";
import { expectNoBootErrorPanel, watchAppErrors } from "./helpers/diagnostics";
import {
  createSeedIdentity,
  setSeedLoginStorage,
  type SeedIdentity,
} from "./helpers/identity";
import { stubFiatRates, stubThirdPartyAssets } from "./helpers/network";
import { isNostrRelay } from "./helpers/stack";
import { topUp } from "./helpers/wallet";
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
const RESUMED_TOKEN_SAT = 13;
const FUNDING_SAT = 100;
/** Lets a receive that follows the replayed message show up. */
const SETTLE_MS = 3_000;
const RECEIVE_MINT_PATHS = ["/v1/checkstate", "/v1/swap"];

const cutOffMint = (context: BrowserContext) =>
  context.route(`${mintUrl}/**`, (route) => route.abort("connectionrefused"));

const pasteUnreachableToken = async (page: Page, token: string) => {
  await page.goto("/#wallet/token/new");
  await page.locator("textarea").fill(token);
  await expect(
    page.getByText("The mint is unreachable. The token is saved"),
  ).toBeVisible();
};

const operationRows = (page: Page) =>
  page.evaluate(async () => {
    if (!window.__linkyE2E) throw new Error("test hooks missing");
    const rows = await window.__linkyE2E.shardRows("cashu", "cashuOperation");
    return rows.map((row) => [row.kind, row.status]);
  });

const mintChoice = (page: Page) =>
  page.getByTestId("mint-choice").filter({ hasText: new URL(mintUrl).host });

const pendingLine = (page: Page) => page.getByTestId("wallet-pending");

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

test("a token waiting for its mint can be discarded, and another resumes when the mint answers", async ({
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

  const discardedToken = await fundToken(TOKEN_SAT);
  const resumedToken = await fundToken(RESUMED_TOKEN_SAT);
  await cutOffMint(context);

  await test.step("a pasted token is kept and shown as pending, apart from the balance", async () => {
    await pasteUnreachableToken(page, discardedToken);
    await expect
      .poll(() => operationRows(page))
      .toEqual([["deferredReceive", "pending"]]);
    await page.goto("/#advanced/mints");
    const mintPending = mintChoice(page).getByTestId("mint-pending");
    await expect(mintPending).toHaveText(`${TOKEN_SAT} sat pending`);
    await page.reload();
    await expect(mintPending).toHaveText(`${TOKEN_SAT} sat pending`);
    await page.goto("/#wallet");
    await expect(pendingLine(page)).toHaveText(`${TOKEN_SAT} sat pending`);
    expect(await readBalanceSat(page)).toBe(0);
  });

  await test.step("the pending line opens the mint, which copies the token text", async () => {
    await pendingLine(page).click();
    await expect(page.getByText("Waiting for the mint")).toBeVisible();
    await page.getByRole("button", { name: "Copy token" }).click();
    await expect.poll(() => copiedText(page)).toBe(discardedToken);
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
    await page.goto("/#wallet");
    await expect(pendingLine(page)).toHaveCount(0);
  });

  await test.step("a second kept token lands in the balance once the mint answers", async () => {
    await pasteUnreachableToken(page, resumedToken);
    await page.goto("/#wallet");
    await expect(pendingLine(page)).toHaveText(
      `${RESUMED_TOKEN_SAT} sat pending`,
    );
    await context.unroute(`${mintUrl}/**`);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    // Net of the mint's input fee, one sat at most per proof.
    await expect
      .poll(() => readBalanceSat(page), { timeout: 60_000 })
      .toBeGreaterThan(RESUMED_TOKEN_SAT - 3);
    expect(await readBalanceSat(page)).toBeLessThanOrEqual(RESUMED_TOKEN_SAT);
    await expect
      .poll(async () => (await operationRows(page)).sort())
      .toEqual([
        ["deferredReceive", "done"],
        ["deferredReceive", "done"],
        ["receive", "done"],
      ]);
    await expect(pendingLine(page)).toHaveCount(0);
    await page.goto("/#advanced/mints");
    await expect(mintChoice(page)).toContainText(/\d+ sat/);
    await expect(mintChoice(page).getByTestId("mint-pending")).toHaveCount(0);
  });

  await expectNoBootErrorPanel(page, "A");
  errors.assertClean();
  await context.close();
});

const bootDevice = async (
  browser: Browser,
  label: string,
  identity: SeedIdentity,
) => {
  const context = await browser.newContext({
    serviceWorkers: "block",
    viewport: { ...MOBILE_VIEWPORT },
  });
  const page = await context.newPage();
  const errors = watchAppErrors(page, label);
  await setBaseStorage(page);
  await setSeedLoginStorage(page, identity);
  await stubFiatRates(page);
  await stubThirdPartyAssets(page);
  return { context, errors, page };
};

const sendTokenInChat = async (page: Page, sat: number): Promise<void> => {
  await page.goto("/#wallet/token/emit");
  for (const digit of String(sat).split("")) {
    await page.getByRole("button", { exact: true, name: digit }).click();
  }
  await page.getByRole("button", { exact: true, name: "Issue" }).click();
  await expect(page).toHaveURL(/#wallet\/token\/(?!emit$)[A-Za-z0-9_-]+$/);
  await page.getByRole("button", { name: "Send to Contact" }).click();
  await page.waitForURL(/#contacts$/);
  await page.locator("[data-guide='contact-card']").first().click();
  await page.waitForURL(/#chat\/[^/]+$/);
};

/** Holds what the app sends to the Nostr relay until the returned release. */
const holdNostrRelay = async (context: BrowserContext) => {
  let held: Array<() => void> | null = [];
  await context.routeWebSocket(isNostrRelay, (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      if (held === null) server.send(message);
      else held.push(() => server.send(message));
    });
  });
  return () => {
    const queued = held ?? [];
    held = null;
    for (const send of queued) send();
  };
};

test("a token discarded on one device stays discarded when another device replays its message", async ({
  browser,
}) => {
  const aIdentity = await createSeedIdentity();
  const bIdentity = await createSeedIdentity();
  const a = await bootDevice(browser, "A", aIdentity);
  const b = await bootDevice(browser, "B", bIdentity);
  for (const device of [a, b]) {
    await device.page.goto("/#wallet");
    await waitForNetworkReady(device.page);
  }

  await test.step("A pays B a chat token while B cannot reach the mint", async () => {
    await topUp(a.page, FUNDING_SAT);
    await expect.poll(() => readBalanceSat(a.page)).toBe(FUNDING_SAT);
    await addContactByNpub(a.page, bIdentity.npub);
    await addContactByNpub(b.page, aIdentity.npub);
    await cutOffMint(b.context);
    await sendTokenInChat(a.page, TOKEN_SAT);
    await b.page.goto("/#wallet");
    await expect(pendingLine(b.page)).toHaveText(`${TOKEN_SAT} sat pending`, {
      timeout: 60_000,
    });
  });

  await test.step("B discards it", async () => {
    await pendingLine(b.page).click();
    await b.page.getByRole("button", { name: "Discard" }).click();
    await b.page
      .getByRole("dialog", { name: "Discard this token?" })
      .getByRole("button", { name: "Discard" })
      .click();
    await expect
      .poll(() => operationRows(b.page))
      .toEqual([["deferredReceive", "done"]]);
  });

  let discardingDevice: typeof b | null = b;

  for (const mintDown of [true, false]) {
    const label = `B again, mint ${mintDown ? "down" : "up"}`;
    await test.step(`${label}: the synced discard holds when the chat replays`, async () => {
      const restored = await bootDevice(browser, label, bIdentity);
      const releaseRelay = await holdNostrRelay(restored.context);
      if (mintDown) await cutOffMint(restored.context);
      const receiveCalls: string[] = [];
      restored.page.on("request", (request) => {
        const path = new URL(request.url()).pathname;
        if (RECEIVE_MINT_PATHS.includes(path)) receiveCalls.push(path);
      });
      await restored.page.goto("/#wallet");
      await waitForNetworkReady(restored.page);
      await expect
        .poll(() => operationRows(restored.page), { timeout: 60_000 })
        .toEqual([["deferredReceive", "done"]]);
      if (discardingDevice !== null) {
        // The discard reached the Evolu server, so its device may go.
        discardingDevice.errors.assertClean();
        await discardingDevice.context.close();
        discardingDevice = null;
      }

      releaseRelay();
      // The replayed message shows its token as taken, so auto-accept skips it.
      await restored.page.goto("/#contacts");
      await restored.page
        .locator("[data-guide='contact-card']")
        .first()
        .click({ timeout: 60_000 });
      await expect(
        restored.page
          .getByTestId("cashu-token-pill")
          .and(restored.page.getByLabel(/already spent/)),
      ).toBeVisible({ timeout: 60_000 });
      await restored.page.waitForTimeout(SETTLE_MS);
      await restored.page.goto("/#wallet");
      expect(await operationRows(restored.page)).toEqual([
        ["deferredReceive", "done"],
      ]);
      expect(await readBalanceSat(restored.page)).toBe(0);
      await expect(pendingLine(restored.page)).toHaveCount(0);
      expect(receiveCalls, "the discarded token was received again").toEqual(
        [],
      );
      await expectNoBootErrorPanel(restored.page, label);
      restored.errors.assertClean();
      await restored.context.close();
    });
  }

  a.errors.assertClean();
  await a.context.close();
});
