/**
 * Seed restore → chat tokens already received on the old device stay settled.
 *
 * A sends B tokens in chat and B's wallet auto-accepts them. B then logs in
 * with the same seed in a fresh browser, and the Nostr inbox replays the old
 * tokens before Evolu brings back the wallet history that says they were
 * received. The restored device must stay quiet: no receive status and no
 * swap at the mint. With the mint unreachable it keeps the tokens only as
 * deferred receives, which close once the mint reports them spent.
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
import { addContactByNpub } from "./helpers/contacts";
import { expectNoBootErrorPanel, watchAppErrors } from "./helpers/diagnostics";
import {
  createSeedIdentity,
  setSeedLoginStorage,
  type SeedIdentity,
} from "./helpers/identity";
import { stubFiatRates, stubThirdPartyAssets } from "./helpers/network";
import { topUp } from "./helpers/wallet";
import type { LinkyE2eHooks } from "../src/devtools/e2e/installLinkyE2eHooks";

declare global {
  interface Window {
    __linkyE2E?: LinkyE2eHooks;
    __receiveStatuses?: string[];
  }
}

const FUNDING_SAT = 100;
const TOKEN_SATS = [10, 7, 5] as const;
/** Lets a status or swap that follows the last mint answer show up. */
const SETTLE_MS = 2_000;
const RECEIVE_MINT_PATHS = ["/v1/checkstate", "/v1/swap"];

interface Device {
  context: BrowserContext;
  errors: ReturnType<typeof watchAppErrors>;
  page: Page;
}

const bootDevice = async (
  browser: Browser,
  label: string,
  identity: SeedIdentity,
): Promise<Device> => {
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

/** Records every receive status the page renders, however briefly. */
const watchReceiveStatuses = (page: Page) =>
  page.addInitScript(() => {
    const seen: string[] = [];
    window.__receiveStatuses = seen;
    new MutationObserver(() => {
      for (const line of (document.body?.innerText ?? "").split("\n")) {
        if (
          /Accepting token|Failed to accept token|already have this Cashu token|mint is unreachable/.test(
            line,
          )
        ) {
          if (!seen.includes(line)) seen.push(line);
        }
      }
    }).observe(document, {
      characterData: true,
      childList: true,
      subtree: true,
    });
  });

/**
 * B in a fresh browser with the Evolu history held back until `releaseEvolu`;
 * meanwhile the old chat tokens come back only through the Nostr inbox
 * backfill. Records the mint paths the page calls and the receive answers
 * it gets back.
 */
const bootRestored = async (
  browser: Browser,
  label: string,
  identity: SeedIdentity,
) => {
  const device = await bootDevice(browser, label, identity);
  await watchReceiveStatuses(device.page);
  await device.page.addInitScript(() => {
    if (sessionStorage.getItem("e2e.evolu-released") === "1") return;
    localStorage.setItem(
      "linky.evoluServers.disabled.v1",
      JSON.stringify(["ws://localhost:4001"]),
    );
  });
  const mintCalls: string[] = [];
  device.page.on("request", (request) => {
    mintCalls.push(new URL(request.url()).pathname);
  });
  const mintAnswers: string[] = [];
  device.page.on("response", (response) => {
    const path = new URL(response.url()).pathname;
    if (RECEIVE_MINT_PATHS.includes(path)) mintAnswers.push(path);
  });
  const releaseEvolu = async () => {
    await device.page.evaluate(() => {
      sessionStorage.setItem("e2e.evolu-released", "1");
      localStorage.removeItem("linky.evoluServers.disabled.v1");
    });
    await device.page.reload();
    await waitForNetworkReady(device.page);
  };
  return { ...device, mintAnswers, mintCalls, releaseEvolu };
};

const openReplayedChat = async (page: Page): Promise<void> => {
  await page.goto("/#wallet");
  await waitForNetworkReady(page);
  await page.goto("/#contacts");
  await expect(page.locator("[data-guide='contact-card']")).toHaveCount(1, {
    timeout: 60_000,
  });
};

const receiveStatuses = (page: Page) =>
  page.evaluate(() => window.__receiveStatuses ?? []);

const operationRows = (page: Page) =>
  page.evaluate(async () => {
    if (!window.__linkyE2E) throw new Error("test hooks missing");
    const rows = await window.__linkyE2E.shardRows("cashu", "cashuOperation");
    return rows.map((row) => [row.kind, row.status]);
  });

const expectOldReceivesIntact = async (
  page: Page,
  balance: number,
): Promise<void> => {
  await expect
    .poll(() => readBalanceSat(page), { timeout: 60_000 })
    .toBe(balance);
  await expect
    .poll(async () =>
      (await operationRows(page)).filter(([kind]) => kind === "receive"),
    )
    .toEqual(TOKEN_SATS.map(() => ["receive", "done"]));
};

test("a seed restore does not re-accept chat tokens the old device received", async ({
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

  let bBalance = 0;
  await test.step("A pays B several chat tokens that B auto-accepts", async () => {
    await topUp(a.page, FUNDING_SAT);
    await expect.poll(() => readBalanceSat(a.page)).toBe(FUNDING_SAT);
    await addContactByNpub(a.page, bIdentity.npub);
    await addContactByNpub(b.page, aIdentity.npub);
    let received = 0;
    for (const sat of TOKEN_SATS) {
      await sendTokenInChat(a.page, sat);
      received += sat;
      await b.page.goto("/#wallet");
      await expect
        .poll(() => readBalanceSat(b.page), { timeout: 60_000 })
        .toBeGreaterThanOrEqual(received - 2 * TOKEN_SATS.length);
    }
    bBalance = await readBalanceSat(b.page);
    await b.context.close();
  });

  await test.step("B restores the seed while its mint is unreachable", async () => {
    const restored = await bootRestored(browser, "B mint down", bIdentity);
    const mintRoute = "http://localhost:3338/**";
    await restored.context.route(mintRoute, (route) =>
      route.abort("connectionrefused"),
    );
    await openReplayedChat(restored.page);
    // Each replayed token is kept under its own deferral, never a receive
    // row that could sync over the old device's `done` receive.
    await expect
      .poll(() => operationRows(restored.page), { timeout: 60_000 })
      .toEqual(TOKEN_SATS.map(() => ["deferredReceive", "pending"]));

    await restored.context.unroute(mintRoute);
    await restored.page.evaluate(() =>
      window.dispatchEvent(new Event("online")),
    );
    // The mint reports the token spent, so the deferral closes silently.
    await expect
      .poll(() => operationRows(restored.page), { timeout: 60_000 })
      .toEqual(TOKEN_SATS.map(() => ["deferredReceive", "failed"]));
    expect(
      await receiveStatuses(restored.page),
      "restored device reported receive statuses",
    ).toEqual([]);
    expect(
      restored.mintCalls.filter((path) => path === "/v1/swap"),
      "restored device swapped a received token again",
    ).toEqual([]);

    await restored.releaseEvolu();
    await expectOldReceivesIntact(restored.page, bBalance);
    await expectNoBootErrorPanel(restored.page, "B mint down");
    await restored.context.close();
  });

  await test.step("B restores the seed before its Evolu history arrives", async () => {
    const restored = await bootRestored(browser, "B restored", bIdentity);
    await openReplayedChat(restored.page);
    // Every replayed token's receive ends on a mint answer.
    await expect
      .poll(() => restored.mintAnswers.length, { timeout: 60_000 })
      .toBeGreaterThanOrEqual(TOKEN_SATS.length);
    await restored.page.waitForTimeout(SETTLE_MS);

    expect(
      await receiveStatuses(restored.page),
      "restored device reported receive statuses",
    ).toEqual([]);
    expect(
      restored.mintCalls.filter((path) => path === "/v1/swap"),
      "restored device swapped a received token again",
    ).toEqual([]);
    expect(
      await operationRows(restored.page),
      "restored device recorded a receive",
    ).toEqual([]);

    // Once the history arrives, the old device's receives are intact.
    await restored.releaseEvolu();
    await expectOldReceivesIntact(restored.page, bBalance);
    await expectNoBootErrorPanel(restored.page, "B restored");
    await restored.context.close();
  });

  a.errors.assertClean();
  await a.context.close();
});
