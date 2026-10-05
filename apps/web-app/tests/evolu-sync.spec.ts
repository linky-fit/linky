import { test, expect, type Page } from "@playwright/test";
import { MOBILE_VIEWPORT, setBaseStorage } from "./helpers/appState";
import { createSeedIdentity, setSeedLoginStorage } from "./helpers/identity";
import { isHydrated } from "./helpers/linkyHooks";
import { stubFiatRates } from "./helpers/network";
import { watchAppErrors } from "./helpers/diagnostics";
import { sendDirectMessage, watchNostrInbox } from "./helpers/relay";
import { EVOLU_RELAY_URL, isNostrRelay } from "./helpers/stack";

test("an unknown sender's message reaches a device that has no Nostr relay, and moves when the sender is added", async ({
  browser,
}, testInfo) => {
  const identity = await createSeedIdentity();
  const unknownSender = await createSeedIdentity();
  const text = "Hello from an unknown sender";
  const open = async (label: string) => {
    const context = await browser.newContext({
      baseURL: testInfo.project.use.baseURL,
      viewport: MOBILE_VIEWPORT,
    });
    const page = await context.newPage();
    const errors = watchAppErrors(page, label);
    await setBaseStorage(page);
    await setSeedLoginStorage(page, identity);
    await stubFiatRates(page);
    return { context, errors, page };
  };
  const nostrDevice = await open("nostr");
  const evoluOnlyDevice = await open("evolu-only");
  // This device hears nothing from the Nostr relay; only Evolu can bring the message.
  await evoluOnlyDevice.context.routeWebSocket(isNostrRelay, () => {});
  const devices = [nostrDevice, evoluOnlyDevice];
  const unknownCard = (page: Page) =>
    page.locator(
      "[data-guide='contact-card'][data-guide-contact-id^='unknown:']",
    );
  try {
    const inboxReady = watchNostrInbox(nostrDevice.page, identity.npub);
    await nostrDevice.page.goto("/#contacts");
    await inboxReady();
    await evoluOnlyDevice.page.goto("/#contacts");
    await expect.poll(() => isHydrated(evoluOnlyDevice.page)).toBe(true);

    await sendDirectMessage(unknownSender.nsec, identity.npub, text);

    await test.step("both devices list the unknown sender's chat", async () => {
      await expect(unknownCard(nostrDevice.page)).toHaveCount(1);
      await expect(unknownCard(evoluOnlyDevice.page)).toHaveCount(1, {
        timeout: 30_000,
      });
      await unknownCard(evoluOnlyDevice.page).click();
      await expect(
        evoluOnlyDevice.page
          .getByTestId("chat-bubble")
          .filter({ hasText: text }),
      ).toBeVisible();
    });

    await test.step("adding the sender moves the message onto the contact on both devices", async () => {
      await unknownCard(nostrDevice.page).click();
      await nostrDevice.page
        .getByRole("button", { name: "Add contact", exact: true })
        .click();
      // Adding opens the contact's chat once the contact is saved.
      await expect(nostrDevice.page).toHaveURL(/#chat\/(?!unknown)[^/]+$/);
      await expect(
        nostrDevice.page.getByTestId("chat-bubble").filter({ hasText: text }),
      ).toBeVisible();
      await evoluOnlyDevice.page.goto("/#contacts");
      await expect(unknownCard(evoluOnlyDevice.page)).toHaveCount(0, {
        timeout: 30_000,
      });
      await evoluOnlyDevice.page
        .locator("[data-guide='contact-card']")
        .first()
        .click();
      await expect(
        evoluOnlyDevice.page
          .getByTestId("chat-bubble")
          .filter({ hasText: text }),
      ).toBeVisible();
      await testInfo.attach("moved chat on the Evolu-only device", {
        body: await evoluOnlyDevice.page.screenshot(),
        contentType: "image/png",
      });
    });
    for (const { errors } of devices) errors.assertClean();
  } finally {
    for (const { context } of devices) await context.close();
  }
});

test("the network dot turns synced once the relays delivered, and shows no connection without an Evolu relay", async ({
  browser,
}, testInfo) => {
  const identity = await createSeedIdentity();
  const open = async (disableEvoluRelay: boolean) => {
    const context = await browser.newContext({
      baseURL: testInfo.project.use.baseURL,
      viewport: MOBILE_VIEWPORT,
    });
    const page = await context.newPage();
    await setBaseStorage(page);
    await setSeedLoginStorage(page, identity);
    await stubFiatRates(page);
    if (disableEvoluRelay)
      await page.addInitScript((relay) => {
        localStorage.setItem(
          "linky.evoluServers.disabled.v1",
          JSON.stringify([relay]),
        );
      }, EVOLU_RELAY_URL);
    await page.goto("/#contacts");
    return { context, page };
  };

  const connected = await open(false);
  try {
    await expect(
      connected.page.getByRole("button", { name: "Synced" }),
    ).toBeVisible({ timeout: 30_000 });
  } finally {
    await connected.context.close();
  }

  const disconnected = await open(true);
  try {
    await expect(
      disconnected.page.getByRole("button", { name: "No connection" }),
    ).toBeVisible();
  } finally {
    await disconnected.context.close();
  }
});
