import { expect, type Page } from "@playwright/test";
import { UNKNOWN_CONTACT_ID_PREFIX } from "../../src/utils/constants";

/**
 * Add a contact by npub and return its local contact id.
 *
 * addNewContactFromSearchResult navigates to #contacts (useContactEditor.ts),
 * not into a chat, so the id has to be read after opening the card.
 * The search does a Nostr metadata lookup, hence the generous timeout.
 */
export const addContactByNpub = async (
  page: Page,
  npub: string,
): Promise<string> => {
  await page.goto("/#contacts");
  const addButton = page.locator("[data-guide='contact-add-button']").first();
  await expect(addButton).toBeVisible();
  // An unknown sender's card turns into the saved contact, so only saved cards count.
  const cards = page.locator(
    `[data-guide='contact-card']:not([data-guide-contact-id^='${UNKNOWN_CONTACT_ID_PREFIX}'])`,
  );
  const previousCount = await cards.count();
  await addButton.click();
  await page.waitForURL(/#contact\/new$/, { timeout: 20_000 });

  const searchInput = page.locator("[data-guide='contact-search-input']");
  await expect(searchInput).toBeVisible();
  await searchInput.fill(npub);
  await searchInput.press("Enter");

  await page.getByRole("button", { exact: true, name: "Add" }).click({
    timeout: 30_000,
  });
  await page.waitForURL(/#(?:contacts)?$/, { timeout: 20_000 });

  await expect(cards).toHaveCount(previousCount + 1, { timeout: 20_000 });
  await cards.first().click();
  await page.waitForURL(/#chat\/[^/]+$/, { timeout: 20_000 });

  const match = new URL(page.url()).hash.match(/^#chat\/([^/]+)$/);
  if (!match?.[1]) {
    throw new Error(`Could not parse contact id from ${page.url()}`);
  }
  return decodeURIComponent(match[1]);
};

/**
 * Wait until this contact's NIP-38 status has arrived through the linkstr
 * profile watch and landed in the cache, so the next step can rely on it.
 */
export const waitForContactStatusFetched = async (
  page: Page,
  npub: string,
): Promise<void> => {
  await expect
    .poll(
      () =>
        page.evaluate(
          (key) => localStorage.getItem(key),
          `linky_nostr_status_v2:${npub}`,
        ),
      { timeout: 60_000 },
    )
    .not.toBeNull();
};
