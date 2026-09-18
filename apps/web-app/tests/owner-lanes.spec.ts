import { expect, test, type Page } from "@playwright/test";
import type { LinkyE2eHooks } from "../src/devtools/e2e/installLinkyE2eHooks";
import {
  readBalanceSat,
  setBaseStorage,
  MOBILE_VIEWPORT,
} from "./helpers/appState";
import { addContactByNpub } from "./helpers/contacts";
import { watchAppErrors } from "./helpers/diagnostics";
import { createSeedIdentity, setSeedLoginStorage } from "./helpers/identity";
import { stubFiatRates, stubThirdPartyAssets } from "./helpers/network";
import { topUp } from "./helpers/wallet";

declare global {
  interface Window {
    __linkyE2E?: LinkyE2eHooks;
  }
}

test.use({ actionTimeout: 20_000 });

/** The old owner lanes mirror their active index in localStorage. */
const laneIndex = (page: Page, scope: string) =>
  page.evaluate(
    (name) =>
      Number(localStorage.getItem(`linky.evolu.${name}_owner_index.v1`)),
    scope,
  );

/** Transactions live on shards; their pointer is a synced row in the app owner. */
const transactionsShardIndex = (page: Page) =>
  page.evaluate(async () => {
    if (!window.__linkyE2E) throw new Error("test hooks missing");
    const pointers = await window.__linkyE2E.shardRows("meta", "shardPointer");
    const pointer = pointers.find((row) => row.scope === "transactions");
    return typeof pointer?.index === "number" ? pointer.index : 0;
  });

test("contact, message and transaction rotations preserve old rows and sync new writes", async ({
  browser,
}, testInfo) => {
  const identity = await createSeedIdentity();
  const peer = await createSeedIdentity();
  const devices = [];
  for (const label of ["rotation source", "rotation follower"]) {
    const context = await browser.newContext({
      baseURL: testInfo.project.use.baseURL,
      serviceWorkers: "block",
      viewport: MOBILE_VIEWPORT,
    });
    const page = await context.newPage();
    const errors = watchAppErrors(page, label);
    await setBaseStorage(page);
    await setSeedLoginStorage(page, identity);
    await stubFiatRates(page);
    await stubThirdPartyAssets(page);
    await page.goto("/#wallet");
    await expect(page.getByLabel("Available balance")).toBeVisible();
    devices.push({ context, page, errors });
  }
  const [source, follower] = devices;
  try {
    const contactId = await addContactByNpub(source.page, peer.npub);
    await source.page
      .locator('[data-guide="chat-input"]')
      .fill("Before owner rotation");
    await source.page.locator('[data-guide="chat-send"]').click();
    await follower.page.goto(`/#chat/${contactId}`);
    await expect(
      follower.page
        .locator(".chat-bubble")
        .filter({ hasText: "Before owner rotation" }),
    ).toBeVisible();
    await topUp(source.page, 32);
    await expect.poll(() => readBalanceSat(source.page)).toBe(32);
    for (const device of devices) {
      await device.page.goto("/#wallet/transactions");
      await expect(device.page.locator(".transaction-card")).toHaveCount(1);
    }

    await test.step("rotate each lane and observe its pointer on the other device", async () => {
      for (const lane of [
        { scope: "contacts", button: "Rotate contacts and tokens owner" },
        { scope: "messages", button: "Rotate messages owner" },
        { scope: "transactions", button: "Rotate transactions owner" },
      ]) {
        await source.page.goto("/#evolu-current-data");
        await source.page
          .getByRole("button", { name: lane.button, exact: true })
          .first()
          .click();
        for (const device of devices) {
          await expect
            .poll(() =>
              lane.scope === "transactions"
                ? transactionsShardIndex(device.page)
                : laneIndex(device.page, lane.scope),
            )
            .toBe(1);
        }
      }
    });

    await test.step("edit an old-lane contact and create a new-lane contact", async () => {
      await source.page.goto(`/#contact/${contactId}/edit`);
      await source.page
        .locator(".form-grid input")
        .first()
        .fill("Updated after rotation");
      await source.page
        .getByRole("button", { name: "Save changes", exact: true })
        .click();
      const nextPeer = await createSeedIdentity();
      await addContactByNpub(source.page, nextPeer.npub);
      await follower.page.goto("/#contacts");
      await expect(
        follower.page.locator('[data-guide="contact-card"]'),
      ).toHaveCount(2);
      await expect(
        follower.page
          .locator('[data-guide="contact-card"]')
          .filter({ hasText: "Updated after rotation" }),
      ).toHaveCount(1);
    });

    await test.step("new messages and topups coexist with old-lane history", async () => {
      await source.page.goto(`/#chat/${contactId}`);
      await source.page
        .locator('[data-guide="chat-input"]')
        .fill("After owner rotation");
      await source.page.locator('[data-guide="chat-send"]').click();
      await topUp(source.page, 16);
      await expect.poll(() => readBalanceSat(source.page)).toBe(48);
      for (const device of devices) {
        await device.page.reload();
        await device.page.goto("/#contacts");
        await expect(
          device.page.locator('[data-guide="contact-card"]'),
        ).toHaveCount(2);
        await device.page.goto(`/#chat/${contactId}`);
        for (const text of ["Before owner rotation", "After owner rotation"])
          await expect(
            device.page.locator(".chat-bubble").filter({ hasText: text }),
          ).toBeVisible();
        await device.page.goto("/#wallet/transactions");
        await expect(device.page.locator(".transaction-card")).toHaveCount(2);
        await testInfo.attach("transactions across owner lanes", {
          body: await device.page.screenshot(),
          contentType: "image/png",
        });
        device.errors.assertClean();
      }
    });
  } finally {
    for (const device of devices) await device.context.close();
  }
});
