/**
 * A deleted contact blocked from the deletion's toast leaves the mute list
 * only when Settings unblocks it, and writes again after that. A second
 * device on the same seed, open the whole time, follows the block and the
 * unblock without a reload, and the first device follows its unblock.
 *
 * Needs the docker stack up — see playwright.config.ts.
 */
import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  expectSingleLoad,
  MOBILE_VIEWPORT,
  setBaseStorage,
} from "./helpers/appState";
import { addContactByNpub } from "./helpers/contacts";
import { watchAppErrors } from "./helpers/diagnostics";
import {
  createSeedIdentity,
  setSeedLoginStorage,
  type SeedIdentity,
} from "./helpers/identity";
import { stubFiatRates, stubThirdPartyAssets } from "./helpers/network";
import {
  npubToHex,
  sendDirectMessage,
  waitForMuteListOnRelay,
  watchNostrInbox,
} from "./helpers/relay";

test.use({ actionTimeout: 20_000 });

const openDevice = async (
  browser: Browser,
  identity: SeedIdentity,
  label: string,
) => {
  const context = await browser.newContext({
    serviceWorkers: "block",
    viewport: MOBILE_VIEWPORT,
  });
  const page = await context.newPage();
  const errors = watchAppErrors(page, label);
  await setBaseStorage(page);
  await setSeedLoginStorage(page, identity);
  await stubFiatRates(page);
  await stubThirdPartyAssets(page);
  const inboxReady = watchNostrInbox(page, identity.npub);
  await page.goto("/#wallet");
  await inboxReady();
  return { context, errors, label, page };
};

const openBlockedPage = async (page: Page) => {
  await page.goto("/#settings");
  await page.getByText("Blocked", { exact: true }).click();
};

test("blocks a deleted contact from the toast and unblocks it in Settings, on both devices of the seed", async ({
  browser,
}) => {
  const [dave, hynek] = await Promise.all([
    createSeedIdentity(),
    createSeedIdentity(),
  ]);
  const hynekPubkey = npubToHex(hynek.npub);
  const devices = await Promise.all([
    openDevice(browser, dave, "dave"),
    openDevice(browser, dave, "dave-2"),
  ]);
  const [{ page }, { page: secondPage }] = devices;
  try {
    const hynekId = await addContactByNpub(page, hynek.npub);
    const card = (on: Page) =>
      on.locator(
        `[data-guide='contact-card'][data-guide-contact-id='${hynekId}']`,
      );
    const blockedRow = (on: Page) => on.getByTestId(`blocked-${hynekPubkey}`);
    await secondPage.goto("/#contacts");
    await expect(card(secondPage)).toBeVisible({ timeout: 30_000 });
    await openBlockedPage(secondPage);
    await expect(
      secondPage.getByText("You haven't blocked anyone."),
    ).toBeVisible();

    await test.step("deleting offers to block, and blocking publishes the mute list", async () => {
      await page.goto(`/#contact/${hynekId}/edit`);
      await page
        .getByRole("banner")
        .getByRole("button", { name: "Delete contact", exact: true })
        .click();
      // The edit page has its own Block button, so wait until the deletion left it.
      await page.waitForURL(/#contacts$/);
      await page.getByRole("button", { name: "Block", exact: true }).click();
      await expect(page.getByText("Contact blocked.")).toBeVisible();
      await waitForMuteListOnRelay(dave.npub, hynekPubkey);
    });

    // Only a message newer than the deletion restores the contact, and the steps above take under a second.
    const afterDeletionSec = () => Math.floor(Date.now() / 1000) + 2;

    await test.step("the second device's open session applies the block", async () => {
      await expect(blockedRow(secondPage)).toBeVisible();
      await sendDirectMessage(
        hynek.nsec,
        dave.npub,
        "While blocked",
        afterDeletionSec(),
      );
    });

    await test.step("the second device unblocks in Settings, and the first device's open session follows", async () => {
      await openBlockedPage(page);
      await expect(blockedRow(page)).toBeVisible();
      await blockedRow(secondPage)
        .getByRole("button", { name: "Unblock", exact: true })
        .click();
      await expect(blockedRow(secondPage)).toHaveCount(0);
      await waitForMuteListOnRelay(dave.npub, hynekPubkey, false);
      await expect(blockedRow(page)).toHaveCount(0);
      await expect(page.getByText("You haven't blocked anyone.")).toBeVisible();
    });

    await test.step("a new message brings the unblocked contact back, without the one sent while blocked", async () => {
      await sendDirectMessage(
        hynek.nsec,
        dave.npub,
        "Hi again",
        afterDeletionSec(),
      );
      for (const { page: device } of devices) {
        await device.goto("/#contacts");
        await expect(card(device)).toBeVisible();
        await card(device).click();
        const bubbles = device.getByTestId("chat-bubble");
        await expect(bubbles.filter({ hasText: "Hi again" })).toBeVisible();
        await expect(bubbles.filter({ hasText: "While blocked" })).toHaveCount(
          0,
        );
      }
    });

    for (const { errors, label, page: device } of devices) {
      await expectSingleLoad(device, label);
      errors.assertClean();
    }
  } finally {
    for (const { context } of devices) await context.close();
  }
});
