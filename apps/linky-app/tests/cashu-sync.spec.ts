import { test, expect, type Page } from "@playwright/test";
import { mnemonicToSeedSync } from "@scure/bip39";
import type { LinkyE2eHooks } from "../src/devtools/e2e/installLinkyE2eHooks";
import {
  Bip39Seed,
  Receive,
  ReceiveDraft,
  runLinkshu,
} from "@linky-fit/linkshu";
import { Effect } from "effect";
import { fundToken } from "../../../packages/linkshu/tests/integration/helpers";
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
        timeout: 60_000,
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
        const operationTable = source.page.getByRole("table").filter({
          has: source.page.getByRole("columnheader", {
            name: "quoteId",
            exact: true,
          }),
        });
        const dataRows = operationTable.getByRole("row").filter({
          has: source.page.getByRole("cell"),
        });
        await expect(dataRows).toHaveCount(rotation.index);
        const headers = await operationTable
          .getByRole("columnheader")
          .allTextContents();
        const ownerColumn = headers.indexOf("ownerId");
        expect(ownerColumn).toBeGreaterThanOrEqual(0);
        const owners = await Promise.all(
          (await dataRows.all()).map((row) =>
            row.getByRole("cell").nth(ownerColumn).textContent(),
          ),
        );
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
  await expect(page.getByTestId("cashu-token-balance")).toHaveText([
    /^62\s*sat$/,
    /^0\s*sat$/,
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
  await expect(available.getByTestId("proof-section-title")).toHaveText(
    "Available · 60 sat",
  );
  await page
    .getByRole("button", {
      name: "Restore and reclaim all tokens",
      exact: true,
    })
    .click();
  await expect(available.getByTestId("proof-section-title")).toHaveText(
    "Available · 59 sat",
  );
  await page.reload();
  await expect(available.getByTestId("proof-section-title")).toHaveText(
    "Available · 59 sat",
  );
  await expect(page.locator('[aria-label="Handed out"]')).toHaveCount(0);
});
