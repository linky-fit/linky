import { test, expect, type Page } from "@playwright/test";
import { setBaseStorage, expectSingleLoad } from "./helpers/appState";
import { createSeedIdentity, setSeedLoginStorage } from "./helpers/identity";
import { addContactByNpub } from "./helpers/contacts";
import { stubFiatRates } from "./helpers/network";
import { watchAppErrors, expectNoBootErrorPanel } from "./helpers/diagnostics";

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
