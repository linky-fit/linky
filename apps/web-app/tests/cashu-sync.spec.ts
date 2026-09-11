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
        // One topup operation per rotated lane (the restore into lane zero
        // records none): the operation table is the one whose row count
        // tracks rotations, proofs vary per topup amount.
        await source.page.goto("/#evolu-current-data");
        const operationTable = source.page.locator("table").filter({
          has: source.page.getByRole("columnheader", {
            name: "quoteId",
            exact: true,
          }),
        });
        await expect(operationTable.locator("tbody tr")).toHaveCount(
          rotation.index,
        );
        const headers = await operationTable.locator("th").allTextContents();
        const ownerColumn = headers.indexOf("ownerId");
        expect(ownerColumn).toBeGreaterThanOrEqual(0);
        const owners = await operationTable
          .locator(`tbody td:nth-child(${ownerColumn + 1})`)
          .allTextContents();
        expect(new Set(owners).size).toBe(rotation.index);
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

    await test.step("issue tokens until the mutation history rotates the lane", async () => {
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
      // Every issue leaves one send operation behind; the proofs it spent
      // stay on record as `spent`, so nothing is deleted any more.
      await source.page.goto("/#evolu-data");
      const operationRowCount = source.page.locator(".settings-row").filter({
        has: source.page.getByText("cashuOperation", { exact: true }),
      });
      await expect(operationRowCount).toContainText(/\d+ rows/);
      const rows = Number(
        (await operationRowCount.innerText()).match(/(\d+) rows/)?.[1],
      );
      expect(rows).toBeGreaterThanOrEqual(60);
    });

    await test.step("both devices adopt the automatic rotation", async () => {
      // Each issue writes several proof and operation mutations, so the
      // history threshold can trip more than once within the cooldown.
      for (const device of devices) {
        await expect
          .poll(() =>
            device.page.evaluate(() =>
              Number(localStorage.getItem("linky.evolu.cashu_owner_index.v1")),
            ),
          )
          .toBeGreaterThanOrEqual(1);
      }
      const [sourceIndex, secondIndex] = await Promise.all(
        devices.map((device) =>
          device.page.evaluate(() =>
            localStorage.getItem("linky.evolu.cashu_owner_index.v1"),
          ),
        ),
      );
      expect(secondIndex).toBe(sourceIndex);
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
