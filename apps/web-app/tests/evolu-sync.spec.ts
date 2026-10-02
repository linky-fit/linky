import { appOwnerFromMnemonic } from "@linky-fit/linksync";
import { test, expect, type Page } from "@playwright/test";
import {
  MOBILE_VIEWPORT,
  setBaseStorage,
  expectSingleLoad,
} from "./helpers/appState";
import { createSeedIdentity, setSeedLoginStorage } from "./helpers/identity";
import { addContactByNpub } from "./helpers/contacts";
import { isHydrated } from "./helpers/linkyHooks";
import { stubFiatRates } from "./helpers/network";
import { watchAppErrors, expectNoBootErrorPanel } from "./helpers/diagnostics";
import { sendDirectMessage, watchNostrInbox } from "./helpers/relay";
import { EVOLU_RELAY_URL, isNostrRelay } from "./helpers/stack";

const readCurrentRows = async (page: Page): Promise<number> => {
  const row = page.locator(".settings-row").filter({
    has: page.getByText("Data", { exact: true }),
  });
  await expect(row).toContainText(/\d+ rows/);
  return Number((await row.innerText()).match(/(\d+) rows/)?.[1]);
};

test("a second device receives a new contact and updates Evolu row counts without reloading", async ({
  browser,
}, testInfo) => {
  const identity = await createSeedIdentity();
  const contact = await createSeedIdentity();
  const devices = [];
  for (const label of ["source", "restored"]) {
    const context = await browser.newContext({
      baseURL: testInfo.project.use.baseURL,
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    const errors = watchAppErrors(page, label);
    await setBaseStorage(page);
    await setSeedLoginStorage(page, identity);
    await stubFiatRates(page);
    await page.goto("/#evolu-servers");
    await expect(
      page.getByRole("heading", { name: "Row counts" }),
    ).toBeVisible();
    await expect(page.getByLabel("connected", { exact: true })).toBeVisible();
    devices.push({ context, page, errors, label });
  }
  const [source, restored] = devices;
  try {
    const initialRows = await readCurrentRows(restored.page);
    await restored.page.goto("/#contacts");
    await expect(
      restored.page.locator('[data-guide="contact-card"]'),
    ).toHaveCount(0);

    const contactId = await addContactByNpub(source.page, contact.npub);

    await test.step("the already open device receives the contact over Evolu", async () => {
      const cards = restored.page.locator('[data-guide="contact-card"]');
      await expect(cards).toHaveCount(1);
      await cards.first().click();
      await expect(restored.page).toHaveURL(new RegExp(`#chat/${contactId}$`));
    });

    await test.step("diagnostic counts include the synced row without a reload", async () => {
      await restored.page.goto("/#evolu-servers");
      await expect
        .poll(() => readCurrentRows(restored.page))
        .toBeGreaterThan(initialRows);
      await testInfo.attach("synced Evolu row counts", {
        body: await restored.page.screenshot(),
        contentType: "image/png",
      });
    });

    for (const device of devices) {
      await expectSingleLoad(device.page, device.label);
      await expectNoBootErrorPanel(device.page, device.label);
      device.errors.assertClean();
    }
  } finally {
    for (const device of devices) await device.context.close();
  }
});

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
        evoluOnlyDevice.page.locator(".chat-bubble").filter({ hasText: text }),
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
        nostrDevice.page.locator(".chat-bubble").filter({ hasText: text }),
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
        evoluOnlyDevice.page.locator(".chat-bubble").filter({ hasText: text }),
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

test("the Evolu wait status reserves space below the mobile navigation", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setBaseStorage(page);
  const identity = await createSeedIdentity();
  await setSeedLoginStorage(page, identity);
  await stubFiatRates(page);
  await page.addInitScript(
    ({ relay, ownerId }) => {
      localStorage.setItem(
        `linky.shards.awaitingFirstHydration.${ownerId}`,
        "1",
      );
      localStorage.setItem(
        "linky.evoluServers.disabled.v1",
        JSON.stringify([relay]),
      );
    },
    {
      relay: EVOLU_RELAY_URL,
      ownerId: appOwnerFromMnemonic(identity.evoluMnemonic)!.id,
    },
  );
  await page.goto("/#contacts");
  const status = page.getByRole("status").filter({
    hasText: "Waiting for the Evolu relay",
  });
  await expect(status).toBeVisible();
  await testInfo.attach("Evolu wait status on mobile", {
    body: await page.screenshot({
      path: testInfo.outputPath("evolu-wait-mobile.png"),
    }),
    contentType: "image/png",
  });
  const header = await page.locator(".mobile-app-topbar .topbar").boundingBox();
  const banner = await status.boundingBox();
  const content = await page.locator(".main-swipe").boundingBox();
  await testInfo.attach("Evolu wait layout bounds", {
    body: JSON.stringify({ header, banner, content }),
    contentType: "application/json",
  });
  expect(header).not.toBeNull();
  expect(banner).not.toBeNull();
  expect(content).not.toBeNull();
  expect(banner!.y).toBeGreaterThanOrEqual(header!.y + header!.height);
  expect(content!.y).toBeGreaterThanOrEqual(banner!.y + banner!.height);
  await expect(status.locator(".btn-spinner")).toHaveCSS(
    "animation-name",
    "btn-spinner-spin",
  );
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator(".desktop-app-layout")).toBeVisible();
  const desktopBanner = await status.boundingBox();
  const desktopContent = await page
    .locator(".desktop-app-layout")
    .boundingBox();
  expect(desktopContent!.y).toBeGreaterThanOrEqual(
    desktopBanner!.y + desktopBanner!.height,
  );
  expect(desktopContent!.y + desktopContent!.height).toBeLessThanOrEqual(800);
});
