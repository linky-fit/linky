// A profile link opened before onboarding survives creating the profile and the
// reload after it; the hook's branches are covered by useSharedProfileLink.test.tsx.
import { expect, test } from "@playwright/test";
import { MOBILE_VIEWPORT, setBaseStorage } from "./helpers/appState";
import { watchAppErrors } from "./helpers/diagnostics";
import { createSeedIdentity } from "./helpers/identity";
import { shardRows } from "./helpers/linkyHooks";
import { stubFiatRates, stubThirdPartyAssets } from "./helpers/network";

test.use({ serviceWorkers: "block", viewport: MOBILE_VIEWPORT });

test("a new user lands in the shared profile's conversation after creating a profile", async ({
  page,
}) => {
  const peer = await createSeedIdentity();
  const errors = watchAppErrors(page, "new user");
  await setBaseStorage(page);
  await stubFiatRates(page);
  await stubThirdPartyAssets(page);

  await page.goto(`/#add/${peer.npub}`);
  await page.getByRole("button", { name: "Create a profile" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Confirm profile" }).click();

  await expect(page).toHaveURL(/#chat\/[^/]+$/, { timeout: 30_000 });
  await expect(page.locator('[data-guide="chat-input"]')).toHaveText("Hi 👋");
  const contactId = decodeURIComponent(
    new URL(page.url()).hash.slice("#chat/".length),
  );
  const contacts = await shardRows(page, "contacts", "contact");
  expect(
    contacts.filter((row) => row.npub === peer.npub).map((row) => row.id),
  ).toEqual([contactId]);
  errors.assertClean();
});
