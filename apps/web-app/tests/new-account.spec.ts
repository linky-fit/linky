// A profile created, or an account already on the device, saves what the user
// does while no Evolu relay answers.
import { expect, test, type Page } from "@playwright/test";
import { MOBILE_VIEWPORT, setBaseStorage } from "./helpers/appState";
import { addContactByNpub } from "./helpers/contacts";
import { watchAppErrors } from "./helpers/diagnostics";
import { holdEvoluRelay, startSilentEvoluRelay } from "./helpers/evoluRelay";
import { createSeedIdentity, setSeedLoginStorage } from "./helpers/identity";
import { isHydrated, shardRows } from "./helpers/linkyHooks";
import { stubFiatRates, stubThirdPartyAssets } from "./helpers/network";

const logins = [
  {
    device: "a new profile",
    login: async (page: Page) => {
      await page.goto("/");
      await page.getByRole("button", { name: "Create a profile" }).click();
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("button", { name: "Confirm profile" }).click();
      await expect(page.getByLabel("Available balance")).toBeVisible();
    },
  },
  {
    device: "a device upgraded with the account on it",
    login: async (page: Page) =>
      setSeedLoginStorage(page, await createSeedIdentity()),
  },
];

for (const { device, login } of logins) {
  test(`${device} writes before the Evolu relay answers`, async ({ page }) => {
    const relay = await startSilentEvoluRelay();
    try {
      const errors = watchAppErrors(page, device);
      await page.setViewportSize(MOBILE_VIEWPORT);
      await setBaseStorage(page);
      await stubFiatRates(page);
      await stubThirdPartyAssets(page);
      await holdEvoluRelay(page, relay);
      await login(page);

      const contactId = await addContactByNpub(
        page,
        (await createSeedIdentity()).npub,
      );
      await expect
        .poll(async () =>
          (await shardRows(page, "contacts", "contact")).map((row) => row.id),
        )
        .toContain(contactId);
      expect(relay.hasReceivedRequest()).toBe(true);
      expect(await isHydrated(page)).toBe(false);
      errors.assertClean();
    } finally {
      await relay.close();
    }
  });
}
