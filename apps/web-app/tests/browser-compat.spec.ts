import { expect, test } from "@playwright/test";
import { setBaseStorage, MOBILE_VIEWPORT } from "./helpers/appState";
import { addContactByNpub } from "./helpers/contacts";
import { createSeedIdentity, setSeedLoginStorage } from "./helpers/identity";
import { stubFiatRates, stubThirdPartyAssets } from "./helpers/network";

const removeNewBuiltins = () => {
  Reflect.deleteProperty(Array.prototype, "toSorted");
  Reflect.deleteProperty(Set.prototype, "difference");
  Reflect.deleteProperty(Promise, "withResolvers");
};

test.use({ serviceWorkers: "block", viewport: MOBILE_VIEWPORT });

for (const realm of ["page", "worker", "both"]) {
  test(`boots and preserves a contact without newer built-ins (${realm})`, async ({
    page,
  }) => {
    await setBaseStorage(page);
    await setSeedLoginStorage(page, await createSeedIdentity());
    await stubFiatRates(page);
    await stubThirdPartyAssets(page);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    if (realm !== "worker") await page.addInitScript(removeNewBuiltins);
    let workerRequests = 0;
    if (realm !== "page") {
      await page.route(
        /\/assets\/evoluDb\.worker-[^/]+\.js$/,
        async (route) => {
          workerRequests += 1;
          const response = await route.fetch();
          await route.fulfill({
            response,
            body: `(${removeNewBuiltins.toString()})();\n${await response.text()}`,
          });
        },
      );
    }

    await page.goto("/#wallet");
    await expect(page.getByLabel("Available balance")).toBeVisible();
    await addContactByNpub(page, (await createSeedIdentity()).npub);
    await page.goto("/#contacts");
    await expect(page.locator('[data-guide="contact-card"]')).toHaveCount(1);
    await page.reload();
    await expect(page.locator('[data-guide="contact-card"]')).toHaveCount(1);
    if (realm !== "page") expect(workerRequests).toBeGreaterThanOrEqual(2);
    expect(errors).toEqual([]);
  });
}
