import { test, expect } from "@playwright/test";
import { mnemonicToSeedSync } from "@scure/bip39";
import { Bip39Seed, Receive, ReceiveDraft, runLinkshu } from "@linky/linkshu";
import { Effect } from "effect";
import { fundToken } from "../../../packages/linkshu/tests/integration/helpers";
import {
  expectSingleLoad,
  MOBILE_VIEWPORT,
  readBalanceSat,
  setBaseStorage,
  waitForNetworkReady,
} from "./helpers/appState";
import { createSeedIdentity, setSeedLoginStorage } from "./helpers/identity";
import { stubFiatRates } from "./helpers/network";
import { expectNoBootErrorPanel, watchAppErrors } from "./helpers/diagnostics";
import { topUp } from "./helpers/wallet";

test("restored Cashu funds sync to an open second device and survive an owner rotation", async ({
  browser,
}, testInfo) => {
  const identity = await createSeedIdentity();
  const devices = [];
  for (const label of ["restore", "synced"]) {
    const context = await browser.newContext({
      baseURL: testInfo.project.use.baseURL,
      viewport: MOBILE_VIEWPORT,
    });
    const page = await context.newPage();
    const errors = watchAppErrors(page, label);
    await setBaseStorage(page);
    await setSeedLoginStorage(page, identity);
    await stubFiatRates(page);
    await page.goto("/#wallet");
    await waitForNetworkReady(page);
    await expect.poll(() => readBalanceSat(page)).toBe(0);
    devices.push({ context, page, errors, label });
  }

  const [source, second] = devices;
  const secondDeviceRestores: string[] = [];
  second.page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/v1/restore") {
      secondDeviceRestores.push(request.url());
    }
  });
  try {
    const restoredAmount =
      await test.step("fund this seed outside both browser wallets", async () => {
        const token = await fundToken(32);
        const receipt = await runLinkshu(
          {
            bip39Seed: Bip39Seed.make(
              mnemonicToSeedSync(identity.cashuMnemonic),
            ),
          },
          Effect.gen(function* () {
            return yield* (yield* Receive).receive(
              new ReceiveDraft({ text: token }),
            );
          }),
        );
        expect(receipt.amount).toBe(31);
        expect(await readBalanceSat(source.page)).toBe(0);
        expect(await readBalanceSat(second.page)).toBe(0);
        return receipt.amount;
      });

    await test.step("restore on one device and receive the same funds over Evolu on the other", async () => {
      await source.page.goto("/#wallet/tokens");
      await source.page
        .getByRole("button", { name: "Restore tokens", exact: true })
        .click();
      await expect(source.page.getByText(/Restored 31 sat/)).toBeVisible({
        timeout: 90_000,
      });
      await source.page.goto("/#wallet");
      await expect.poll(() => readBalanceSat(source.page)).toBe(restoredAmount);
      await expect.poll(() => readBalanceSat(second.page)).toBe(restoredAmount);
    });

    let expectedBalance = restoredAmount;
    await test.step("rotate twice and keep funds from all three owner lanes", async () => {
      for (const rotation of [
        { index: 1, amount: 64 },
        { index: 2, amount: 32 },
      ]) {
        if (rotation.index === 2) {
          await source.page.evaluate(() => {
            localStorage.setItem(
              "linky.evolu.cashu_owner_last_rotated_at_ms.v1",
              String(Date.now() - 61_000),
            );
          });
        }
        await source.page.goto("/#evolu-current-data");
        await source.page
          .getByRole("button", { name: "Rotate tokens owner", exact: true })
          .click();
        for (const device of devices) {
          await expect
            .poll(() =>
              device.page.evaluate(() =>
                localStorage.getItem("linky.evolu.cashu_owner_index.v1"),
              ),
            )
            .toBe(String(rotation.index));
        }
        await topUp(source.page, rotation.amount);
        expectedBalance += rotation.amount;
        for (const device of devices) {
          await expect
            .poll(() => readBalanceSat(device.page))
            .toBe(expectedBalance);
        }
        await source.page.goto("/#evolu-current-data");
        const tokenTable = source.page.locator("table").filter({
          has: source.page.getByRole("columnheader", {
            name: "originalTokenText",
            exact: true,
          }),
        });
        if (rotation.index === 2) {
          await tokenTable
            .locator("..")
            .getByRole("button", { name: /Show all remaining rows/ })
            .click();
        }
        await expect(tokenTable.locator("tbody tr")).toHaveCount(
          rotation.index + 1,
        );
        const headers = await tokenTable.locator("th").allTextContents();
        const ownerColumn = headers.indexOf("ownerId");
        expect(ownerColumn).toBeGreaterThanOrEqual(0);
        const owners = await tokenTable
          .locator(`tbody td:nth-child(${ownerColumn + 1})`)
          .allTextContents();
        expect(new Set(owners).size).toBe(rotation.index + 1);
        await source.page.goto("/#wallet");
      }
    });

    await test.step("both devices retain their combined balance after reloading", async () => {
      for (const device of devices) {
        await device.page.reload();
        await waitForNetworkReady(device.page);
        await expect
          .poll(() => readBalanceSat(device.page))
          .toBe(expectedBalance);
        await expectNoBootErrorPanel(device.page, device.label);
        device.errors.assertClean();
      }
      expect(secondDeviceRestores).toEqual([]);
    });
  } finally {
    for (const device of devices) await device.context.close();
  }
});

test("a stale initial Cashu lane index recovers when no rows or owner pointer exist", async ({
  page,
}) => {
  const identity = await createSeedIdentity();
  const errors = watchAppErrors(page, "stale lane");
  await setBaseStorage(page);
  await setSeedLoginStorage(page, identity);
  await page.addInitScript(() => {
    localStorage.setItem("linky.evolu.cashu_owner_index.v1", "7");
  });
  await stubFiatRates(page);
  await page.goto("/#wallet");
  await waitForNetworkReady(page);
  await expect
    .poll(() =>
      page.evaluate(() =>
        localStorage.getItem("linky.evolu.cashu_owner_index.v1"),
      ),
    )
    .toBe("0");
  expect(await readBalanceSat(page)).toBe(0);
  await expectSingleLoad(page, "stale lane");
  await expectNoBootErrorPanel(page, "stale lane");
  errors.assertClean();
});

test("token consumption rotates lane zero from its mutation history while few live rows remain", async ({
  browser,
}, testInfo) => {
  const identity = await createSeedIdentity();
  const devices = [];
  for (const label of ["spending", "following"]) {
    const context = await browser.newContext({
      baseURL: testInfo.project.use.baseURL,
      viewport: MOBILE_VIEWPORT,
    });
    const page = await context.newPage();
    const errors = watchAppErrors(page, label);
    await setBaseStorage(page);
    await setSeedLoginStorage(page, identity);
    await stubFiatRates(page);
    await page.goto("/#wallet");
    await waitForNetworkReady(page);
    devices.push({ context, page, errors, label });
  }
  const [source, second] = devices;
  const rotations: {
    issuedTokens: number;
    index: string | null;
    rotatedAt: string | null;
  }[] = [];
  try {
    await topUp(source.page, 512);
    for (const device of devices) {
      await expect.poll(() => readBalanceSat(device.page)).toBe(512);
    }

    await test.step("consume and replace token rows without reaching 170 live rows", async () => {
      for (let index = 0; index < 60; index += 1) {
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
        const lane = await source.page.evaluate(() => ({
          index: localStorage.getItem("linky.evolu.cashu_owner_index.v1"),
          rotatedAt: localStorage.getItem(
            "linky.evolu.cashu_owner_last_rotated_at_ms.v1",
          ),
        }));
        if (rotations.at(-1)?.index !== lane.index) {
          rotations.push({ issuedTokens: index + 1, ...lane });
        }
      }
      await source.page.goto("/#evolu-data");
      const tokenRowCount = source.page.locator(".settings-row").filter({
        has: source.page.getByText("cashuToken", { exact: true }),
      });
      await expect(tokenRowCount).toContainText(/\d+ rows/);
      const rows = Number(
        (await tokenRowCount.innerText()).match(/(\d+) rows/)?.[1],
      );
      expect(rows).toBeGreaterThan(60);
      expect(rows).toBeLessThan(170);
    });

    await test.step("both devices adopt the automatic rotation", async () => {
      for (const device of devices) {
        await expect
          .poll(() =>
            device.page.evaluate(() =>
              localStorage.getItem("linky.evolu.cashu_owner_index.v1"),
            ),
          )
          .toBe("1");
      }
    });

    await source.page.goto("/#wallet");
    const remaining = await readBalanceSat(source.page);
    expect(remaining).toBeGreaterThan(300);
    expect(remaining).toBeLessThanOrEqual(452);
    await expect.poll(() => readBalanceSat(second.page)).toBe(remaining);

    await test.step("new-lane funds and old-lane change remain synced after reload", async () => {
      await topUp(source.page, 64);
      for (const device of devices) {
        await expect
          .poll(() => readBalanceSat(device.page))
          .toBe(remaining + 64);
        await device.page.reload();
        await waitForNetworkReady(device.page);
        await expect
          .poll(() => readBalanceSat(device.page))
          .toBe(remaining + 64);
        await expectNoBootErrorPanel(device.page, device.label);
        device.errors.assertClean();
      }
    });
  } finally {
    await testInfo.attach("automatic Cashu owner transitions", {
      body: JSON.stringify(rotations),
      contentType: "application/json",
    });
    for (const device of devices) await device.context.close();
  }
});
