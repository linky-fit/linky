/**
 * An npub saved as several contacts, one active and the others archived, keeps
 * receiving into the active contact: an archived duplicate never takes the
 * message and so never comes back from the archive as a second conversation.
 *
 * Needs the docker stack up — see playwright.config.ts.
 */
import { expect, test } from "@playwright/test";
import { MOBILE_VIEWPORT, setBaseStorage } from "./helpers/appState";
import { createSeedIdentity, setSeedLoginStorage } from "./helpers/identity";
import {
  createRowId,
  isHydrated,
  shardIndexes,
  shardOwnerId,
  shardRows,
  upsertRow,
} from "./helpers/linkyHooks";
import { stubFiatRates, stubThirdPartyAssets } from "./helpers/network";
import { sendDirectMessage, watchNostrInbox } from "./helpers/relay";

test("a message from a duplicated npub lands on the active contact", async ({
  browser,
}) => {
  const [dave, hynek] = await Promise.all([
    createSeedIdentity(),
    createSeedIdentity(),
  ]);
  const context = await browser.newContext({
    serviceWorkers: "block",
    viewport: { ...MOBILE_VIEWPORT },
  });
  try {
    const page = await context.newPage();
    await setBaseStorage(page);
    await setSeedLoginStorage(page, dave);
    await stubFiatRates(page);
    await stubThirdPartyAssets(page);
    const inboxReady = watchNostrInbox(page, dave.npub);
    await page.goto("/#contacts");
    await expect.poll(() => isHydrated(page), { timeout: 60_000 }).toBe(true);
    await inboxReady();

    const contactsIndex = Number((await shardIndexes(page)).contacts ?? 0);
    const contactsOwner = await shardOwnerId(page, "contacts", contactsIndex);
    // The archived duplicate is written first, so it is the older row.
    const archivedId = await createRowId(page);
    await upsertRow(
      page,
      "contact",
      {
        id: archivedId,
        name: "Hynek",
        npub: hynek.npub,
        archivedAtSec: Math.floor(Date.now() / 1000) - 3600,
      },
      contactsOwner,
    );
    const activeId = await createRowId(page);
    await upsertRow(
      page,
      "contact",
      { id: activeId, name: "Hynek", npub: hynek.npub },
      contactsOwner,
    );
    await expect
      .poll(async () => (await shardRows(page, "contacts", "contact")).length)
      .toBe(2);

    await sendDirectMessage(hynek.nsec, dave.npub, "Yes 😀");

    const card = (id: string) =>
      page.locator(
        `[data-guide='contact-card'][data-guide-contact-id='${id}']`,
      );
    await expect(card(activeId)).toContainText("Yes 😀", { timeout: 30_000 });
    await expect(card(archivedId)).toHaveCount(0);
    const archived = (await shardRows(page, "contacts", "contact")).find(
      (row) => row.id === archivedId,
    );
    expect(archived?.archivedAtSec).toBeGreaterThan(0);
  } finally {
    await context.close();
  }
});
