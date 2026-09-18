import { test, expect, type Page } from "@playwright/test";
import { mnemonicToSeedSync } from "@scure/bip39";
import type { LinkyE2eHooks } from "../src/devtools/e2e/installLinkyE2eHooks";
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

declare global {
  interface Window {
    __linkyE2E?: LinkyE2eHooks;
  }
}

/** The wallet lives on shards; its pointer is a synced row in the app owner. */
const cashuShardIndex = (page: Page) =>
  page.evaluate(async () => {
    if (!window.__linkyE2E) throw new Error("test hooks missing");
    const pointers = await window.__linkyE2E.shardRows("meta", "shardPointer");
    const pointer = pointers.find((row) => row.scope === "cashu");
    return typeof pointer?.index === "number" ? pointer.index : 0;
  });

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
        return receipt.amount - 1;
      });

    await test.step("restore on one device and receive the same funds over Evolu on the other", async () => {
      await source.page.goto("/#wallet/tokens");
      await source.page
        .getByRole("button", { name: "Look for missing tokens", exact: true })
        .click();
      await expect(
        source.page.getByText("Recovered 30 sat into fresh proofs.", {
          exact: true,
        }),
      ).toBeVisible({
        timeout: 90_000,
      });
      await source.page.goto("/#wallet");
      await expect.poll(() => readBalanceSat(source.page)).toBe(restoredAmount);
      await expect.poll(() => readBalanceSat(second.page)).toBe(restoredAmount);
    });

    let expectedBalance = restoredAmount;
    await test.step("rotate twice and keep funds from all three shards", async () => {
      for (const rotation of [
        { index: 1, amount: 64 },
        { index: 2, amount: 32 },
      ]) {
        await source.page.goto("/#evolu-current-data");
        await source.page
          .getByRole("button", { name: "Rotate cashu shard", exact: true })
          .click();
        for (const device of devices) {
          await expect
            .poll(() => cashuShardIndex(device.page))
            .toBe(rotation.index);
        }
        await topUp(source.page, rotation.amount);
        expectedBalance += rotation.amount;
        for (const device of devices) {
          await expect
            .poll(() => readBalanceSat(device.page))
            .toBe(expectedBalance);
        }
        // One topup operation per rotated shard (the restore into shard zero
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

test("a stale legacy Cashu lane index in storage leaves the shards at index zero", async ({
  page,
}) => {
  const identity = await createSeedIdentity();
  const errors = watchAppErrors(page, "stale lane");
  await setBaseStorage(page);
  await setSeedLoginStorage(page, identity);
  // An older version's lane mirror means nothing to the shards: the wallet
  // starts on shard 0 regardless.
  await page.addInitScript(() => {
    localStorage.setItem("linky.evolu.cashu_owner_index.v1", "7");
  });
  await stubFiatRates(page);
  await page.goto("/#wallet");
  await waitForNetworkReady(page);
  await expect.poll(() => cashuShardIndex(page)).toBe(0);
  expect(await readBalanceSat(page)).toBe(0);
  await expectSingleLoad(page, "stale lane");
  await expectNoBootErrorPanel(page, "stale lane");
  errors.assertClean();
});

test("token consumption rotates shard zero from its mutation history while few live rows remain", async ({
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
  const rotations: { issuedTokens: number; index: number }[] = [];
  try {
    await topUp(source.page, 512);
    for (const device of devices) {
      await expect.poll(() => readBalanceSat(device.page)).toBe(512);
    }

    await test.step("issue tokens until the mutation history rotates the shard", async () => {
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
        const shardIndex = await cashuShardIndex(source.page);
        if (rotations.at(-1)?.index !== shardIndex) {
          rotations.push({ issuedTokens: index + 1, index: shardIndex });
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
          .poll(() => cashuShardIndex(device.page))
          .toBeGreaterThanOrEqual(1);
      }
      const [sourceIndex, secondIndex] = await Promise.all(
        devices.map((device) => cashuShardIndex(device.page)),
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

test("token recovery buttons find missing funds and reclaim handed-out proofs", async ({
  page,
}) => {
  const identity = await createSeedIdentity();
  const funded = await fundToken(64);
  await runLinkshu(
    { bip39Seed: Bip39Seed.make(mnemonicToSeedSync(identity.cashuMnemonic)) },
    Effect.gen(function* () {
      yield* (yield* Receive).receive(new ReceiveDraft({ text: funded }));
    }),
  );
  await setBaseStorage(page);
  await setSeedLoginStorage(page, identity);
  await stubFiatRates(page);
  await page.setViewportSize(MOBILE_VIEWPORT);
  await page.goto("/#wallet/tokens");
  await page
    .getByRole("button", { name: "Look for missing tokens", exact: true })
    .click();
  await expect(page.locator(".cashu-token-balance-summary dd")).toHaveText([
    "62 sat",
    "0 sat",
  ]);
  const available = page.locator('[aria-label="Available"]');
  await page.getByRole("button", { name: "Issue", exact: true }).click();
  await page.getByRole("button", { name: "1", exact: true }).click();
  await page.getByRole("button", { name: "6", exact: true }).click();
  await page.getByRole("button", { name: "Issue", exact: true }).click();
  await expect(page.getByText("Issued, waiting to be claimed.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Delete", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "Reclaim and return to wallet",
      exact: true,
    }),
  ).toBeVisible();
  await page.goto("/#wallet/tokens");
  await page
    .getByRole("button", { name: "Inspect proofs", exact: true })
    .click();
  await expect(page.locator('[aria-label="Handed out"]')).toBeVisible();
  await page
    .getByRole("button", { name: "Reclaim all handed-out tokens", exact: true })
    .click();
  await expect(page.locator('[aria-label="Handed out"]')).toHaveCount(0);
  await expect(available.locator(".list-header > span")).toHaveText(
    "Available · 60 sat",
  );
  await page
    .getByRole("button", {
      name: "Restore and reclaim all tokens",
      exact: true,
    })
    .click();
  await expect(available.locator(".list-header > span")).toHaveText(
    "Available · 59 sat",
  );
  await page.reload();
  await expect(available.locator(".list-header > span")).toHaveText(
    "Available · 59 sat",
  );
  await expect(page.locator('[aria-label="Handed out"]')).toHaveCount(0);
});
