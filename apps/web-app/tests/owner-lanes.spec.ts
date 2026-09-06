import { expect, test } from "@playwright/test";
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

test.use({ actionTimeout: 20_000 });

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
              device.page.evaluate(
                (scope) =>
                  localStorage.getItem(`linky.evolu.${scope}_owner_index.v1`),
                lane.scope,
              ),
            )
            .toBe("1");
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
