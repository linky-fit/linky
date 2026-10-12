/**
 * A deleted contact blocked from the deletion's toast leaves the mute list
 * only when Settings unblocks it, and writes again after that.
 *
 * Needs the docker stack up — see playwright.config.ts.
 */
import { expect, test } from "@playwright/test";
import { MOBILE_VIEWPORT, setBaseStorage } from "./helpers/appState";
import { addContactByNpub } from "./helpers/contacts";
import { watchAppErrors } from "./helpers/diagnostics";
import { createSeedIdentity, setSeedLoginStorage } from "./helpers/identity";
import { stubFiatRates, stubThirdPartyAssets } from "./helpers/network";
import {
  npubToHex,
  sendDirectMessage,
  waitForMuteListOnRelay,
  watchNostrInbox,
} from "./helpers/relay";

test.use({ actionTimeout: 20_000 });

test("blocks a deleted contact from the toast and unblocks it in Settings", async ({
  browser,
}) => {
  const [dave, hynek] = await Promise.all([
    createSeedIdentity(),
    createSeedIdentity(),
  ]);
  const hynekPubkey = npubToHex(hynek.npub);
  const context = await browser.newContext({
    serviceWorkers: "block",
    viewport: MOBILE_VIEWPORT,
  });
  try {
    const page = await context.newPage();
    const errors = watchAppErrors(page, "dave");
    await setBaseStorage(page);
    await setSeedLoginStorage(page, dave);
    await stubFiatRates(page);
    await stubThirdPartyAssets(page);
    const inboxReady = watchNostrInbox(page, dave.npub);
    await page.goto("/#wallet");
    await inboxReady();

    const hynekId = await addContactByNpub(page, hynek.npub);
    const card = page.locator(
      `[data-guide='contact-card'][data-guide-contact-id='${hynekId}']`,
    );

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

    await test.step("Settings lists the block and unblocks it", async () => {
      await page.goto("/#settings");
      await page.getByText("Blocked", { exact: true }).click();
      const row = page.getByTestId(`blocked-${hynekPubkey}`);
      await row.getByRole("button", { name: "Unblock", exact: true }).click();
      await expect(row).toHaveCount(0);
      await expect(page.getByText("You haven't blocked anyone.")).toBeVisible();
      await waitForMuteListOnRelay(dave.npub, hynekPubkey, false);
    });

    await test.step("a new message brings the unblocked contact back", async () => {
      await page.goto("/#contacts");
      // Only a message newer than the deletion restores the contact, and the steps above take under a second.
      const afterDeletionSec = Math.floor(Date.now() / 1000) + 2;
      await sendDirectMessage(
        hynek.nsec,
        dave.npub,
        "Hi again",
        afterDeletionSec,
      );
      await expect(card).toBeVisible();
      await card.click();
      await expect(
        page.getByTestId("chat-bubble").filter({ hasText: "Hi again" }),
      ).toBeVisible();
    });

    errors.assertClean();
  } finally {
    await context.close();
  }
});
