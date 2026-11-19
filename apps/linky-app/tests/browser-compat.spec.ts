import { expect, test } from "@playwright/test";
import { setBaseStorage, MOBILE_VIEWPORT } from "./helpers/appState";
import { addContactByNpub } from "./helpers/contacts";
import { EVOLU_WORKER_BUNDLE } from "./helpers/bundles";
import { watchAppErrors } from "./helpers/diagnostics";
import { createSeedIdentity, setSeedLoginStorage } from "./helpers/identity";
import { stubFiatRates, stubThirdPartyAssets } from "./helpers/network";

const removeNewBuiltins = () => {
  Reflect.deleteProperty(Array.prototype, "toSorted");
  Reflect.deleteProperty(Set.prototype, "difference");
  Reflect.deleteProperty(Promise, "withResolvers");
};

test.use({ serviceWorkers: "block", viewport: MOBILE_VIEWPORT });

// Evolu needs BroadcastChannel and Web Locks, which every browser since Safari 15.4 has.
test("an old Safari without newer built-ins boots and keeps a contact", async ({
  page,
}) => {
  const errors = watchAppErrors(page, "old Safari");
  await setBaseStorage(page);
  await setSeedLoginStorage(page, await createSeedIdentity());
  await stubFiatRates(page);
  await stubThirdPartyAssets(page);
  await page.addInitScript(removeNewBuiltins);
  let workerRequests = 0;
  await page.route(EVOLU_WORKER_BUNDLE, async (route) => {
    workerRequests += 1;
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: `(${removeNewBuiltins.toString()})();\n${await response.text()}`,
    });
  });

  await page.goto("/#wallet");
  await expect(page.getByLabel("Available balance")).toBeVisible();
  const id = await addContactByNpub(page, (await createSeedIdentity()).npub);
  await page.reload();
  await expect(page).toHaveURL(new RegExp(`#chat/${id}$`));
  await expect(page.locator('[data-guide="chat-input"]')).toBeVisible();
  await page.goto("/#contacts");
  await expect(page.locator('[data-guide="contact-card"]')).toHaveCount(1);
  expect(workerRequests).toBeGreaterThanOrEqual(2);
  errors.assertClean();
});
