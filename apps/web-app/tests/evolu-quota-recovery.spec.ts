import { test, expect, type Page } from "@playwright/test";
import {
  MOBILE_VIEWPORT,
  readBalanceSat,
  setBaseStorage,
  waitForNetworkReady,
} from "./helpers/appState";
import { createSeedIdentity, setSeedLoginStorage } from "./helpers/identity";
import { stubFiatRates } from "./helpers/network";
import { expectNoBootErrorPanel, watchAppErrors } from "./helpers/diagnostics";
import { topUp } from "./helpers/wallet";

test.use({ actionTimeout: 20_000 });

const addRecoveryRelay = async (page: Page): Promise<void> => {
  await page.goto("/#evolu-server/new");
  await expect(
    page.getByRole("button", { name: "Clear Evolu storage", exact: true }),
  ).toHaveCount(0);
  await page.locator("#evoluServerUrl").fill("ws://localhost:4001");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Reload now", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reload now", exact: true }).click();
  await page.goto("/#wallet");
  await waitForNetworkReady(page);
};

test("adding a relay with capacity syncs quota-rejected token history and spent marks", async ({
  browser,
}, testInfo) => {
  const identity = await createSeedIdentity();
  const devices = [];
  for (const label of ["over quota", "stale device"]) {
    const context = await browser.newContext({
      baseURL: testInfo.project.use.baseURL,
      viewport: MOBILE_VIEWPORT,
    });
    const page = await context.newPage();
    const errors = watchAppErrors(page, label);
    await setBaseStorage(page);
    await setSeedLoginStorage(page, identity);
    await page.addInitScript(() => {
      const initialized = "linky.test.quota-relay-configured";
      if (sessionStorage.getItem(initialized) === "1") return;
      localStorage.setItem("linky.evoluServers.defaultRemoved.v1", "true");
      localStorage.setItem(
        "linky.evoluServers.v1",
        JSON.stringify(["ws://localhost:4002"]),
      );
      sessionStorage.setItem(initialized, "1");
    });
    await stubFiatRates(page);
    await page.goto("/#wallet");
    await waitForNetworkReady(page);
    devices.push({ context, page, errors, label });
  }
  const [source, second] = devices;
  let observingRecovery = false;
  const secondMintResponses: number[] = [];
  second.page.on("response", (response) => {
    if (
      observingRecovery &&
      new URL(response.url()).pathname === "/v1/checkstate"
    )
      secondMintResponses.push(response.status());
  });
  try {
    await topUp(source.page, 512);
    for (const device of devices) {
      await expect.poll(() => readBalanceSat(device.page)).toBe(512);
    }
    await second.page.goto("/#wallet/tokens");
    await second.page
      .getByRole("button", { name: "Token", exact: true })
      .click();
    const originalTokenRoute = new URL(second.page.url()).hash;
    await expect(second.page).toHaveURL(/#wallet\/token\/[A-Za-z0-9_-]+$/);
    await second.page.goto("/#wallet");
    await second.context.setOffline(true);
    await second.page.route("**/v1/checkstate", (route) =>
      route.abort("internetdisconnected"),
    );

    await test.step("new spends exceed the real relay quota and remain local", async () => {
      for (let index = 0; index < 12; index += 1) {
        await source.page.goto("/#wallet/token/emit");
        await source.page
          .getByRole("button", { name: "1", exact: true })
          .click();
        await source.page
          .getByRole("button", { name: "Issue", exact: true })
          .click();
        await expect(source.page).toHaveURL(
          /#wallet\/token\/(?!emit$)[A-Za-z0-9_-]+$/,
        );
      }
      await source.page.goto("/#evolu-servers");
      await expect(source.page.getByRole("alert")).toContainText(
        "Sync storage limit reached",
      );
      await expect(
        source.page.getByRole("button", {
          name: "Clear SQLite file",
          exact: true,
        }),
      ).toBeDisabled();
      expect(await readBalanceSat(second.page)).toBe(512);
      await source.page.goto("/#wallet");
      await expect.poll(() => readBalanceSat(source.page)).toBe(488);
    });

    await test.step("existing local history uploads to a new relay without a database reset", async () => {
      observingRecovery = true;
      await addRecoveryRelay(source.page);
      await second.context.setOffline(false);
      await addRecoveryRelay(second.page);
      for (const device of devices) {
        await expect.poll(() => readBalanceSat(device.page)).toBe(488);
        await device.page.reload();
        await waitForNetworkReady(device.page);
        await expect.poll(() => readBalanceSat(device.page)).toBe(488);
      }
    });

    await test.step("the stale device receives the original token's deletion through Evolu", async () => {
      await second.page.goto(`/${originalTokenRoute}`);
      await expect(
        second.page.getByText("Token is invalid or already spent.", {
          exact: true,
        }),
      ).toBeVisible();
      expect(secondMintResponses).toEqual([]);
      for (const device of devices) {
        await expectNoBootErrorPanel(device.page, device.label);
        device.errors.assertClean();
      }
    });
  } finally {
    for (const device of devices) await device.context.close();
  }
});
