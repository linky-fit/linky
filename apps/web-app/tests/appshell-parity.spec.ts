import { createSlip39Share } from "@linky/identity";
import { expect, test, type Page } from "@playwright/test";
import { Effect } from "effect";
import { MOBILE_VIEWPORT, setBaseStorage } from "./helpers/appState";
import {
  createSeedIdentity,
  setRandomIdentityStorage,
  setSeedLoginStorage,
} from "./helpers/identity";
import { watchAppErrors } from "./helpers/diagnostics";
import { stubFiatRates, stubThirdPartyAssets } from "./helpers/network";

test.use({ serviceWorkers: "block" });

test.beforeEach(async ({ page }) => {
  await stubFiatRates(page);
  await stubThirdPartyAssets(page);
});

const CONTACT_NPUB =
  "npub12g0qmc3xa4hc9nxca936chppd6zhkr494xyypstcd7wg0gaa2xzswunml3";

const setAuthenticatedStorage = async (page: Page) => {
  await setBaseStorage(page);
  await setRandomIdentityStorage(page);
};

const disableOpfs = async (page: Page) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.storage, "getDirectory", {
      configurable: true,
      value: () =>
        Promise.reject(
          new DOMException("OPFS is unavailable", "NotSupportedError"),
        ),
      writable: true,
    });
  });
};

const createContactAndOpenChat = async (
  page: Page,
  addButtonName = "Add",
): Promise<string> => {
  await page.goto("/#");
  await page.locator("[data-guide='contact-add-button']").first().click();
  await page.waitForURL(/#contact\/new$/, { timeout: 10_000 });

  const searchInput = page.locator("[data-guide='contact-search-input']");
  await expect(searchInput).toBeVisible();
  await searchInput.fill(CONTACT_NPUB);
  await searchInput.press("Enter");
  await expect(
    page.getByRole("button", { name: addButtonName, exact: true }),
  ).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: addButtonName, exact: true }).click();

  await page.waitForURL(/#(?:contacts)?$/, { timeout: 20_000 });
  const contactCards = page.locator("[data-guide='contact-card']");
  await expect
    .poll(async () => contactCards.count(), { timeout: 20_000 })
    .toBeGreaterThan(0);
  await contactCards.first().click();
  await page.waitForURL(/#chat\/[^/]+$/, { timeout: 10_000 });
  await expect(page.locator("[data-guide='chat-input']")).toBeVisible();

  const contactMatch = new URL(page.url()).hash.match(/^#chat\/([^/]+)$/);
  if (!contactMatch?.[1]) {
    throw new Error(`Could not parse contact id from ${page.url()}`);
  }
  return decodeURIComponent(contactMatch[1]);
};

test("keeps unauthenticated auth gating without render loops", async ({
  page,
}) => {
  const maximumDepthErrors: string[] = [];
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      message.text().includes("Maximum update depth exceeded")
    ) {
      maximumDepthErrors.push(message.text());
    }
  });
  await setBaseStorage(page);

  await page.goto("/#wallet");

  await expect(
    page.getByRole("button", { name: "Create a profile" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "I already have a profile" }),
  ).toBeVisible();
  await expect(page.locator("[data-guide='contact-add-button']")).toHaveCount(
    0,
  );
  await page.waitForTimeout(3_000);
  expect(maximumDepthErrors).toEqual([]);
});

test("restores an account from SLIP-39 without getting stuck", async ({
  page,
}) => {
  const slip39Share = await Effect.runPromise(createSlip39Share());
  await setBaseStorage(page);
  await page.setViewportSize({ ...MOBILE_VIEWPORT });

  await page.goto("/#wallet");
  await page.getByRole("button", { name: "I already have a profile" }).click();
  await page.getByLabel("Keys").fill(slip39Share);
  const reloadFinished = page.waitForEvent("load");
  await page.getByRole("button", { name: "Continue" }).click();

  // Restore intentionally resets the route to the legacy contacts root.
  await reloadFinished;
  await page.waitForURL(/#$/, { timeout: 30_000 });
  await page.goto("/#wallet");
  await expect(page.getByLabel("Available balance")).toBeVisible({
    timeout: 30_000,
  });
});

test("restores an account when private browsing disables OPFS", async ({
  page,
}) => {
  const slip39Share = await Effect.runPromise(createSlip39Share());
  await setBaseStorage(page);
  await disableOpfs(page);
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto("/#wallet");
  await page
    .getByRole("button", { name: "Continue with temporary session" })
    .click();
  await page.getByRole("button", { name: "I already have a profile" }).click();
  await page.getByLabel("Keys").fill(slip39Share);
  const reloadFinished = page.waitForEvent("load");
  await page.getByRole("button", { name: "Continue" }).click();

  // The consent is remembered in sessionStorage, so the post-restore reload
  // must boot straight into the in-memory session without re-prompting.
  await reloadFinished;
  await page.waitForURL(/#$/, { timeout: 30_000 });
  await page.goto("/#wallet");
  await expect(page.getByLabel("Available balance")).toBeVisible({
    timeout: 30_000,
  });
});

test("preserves route parity and critical handlers", async ({ page }) => {
  await setAuthenticatedStorage(page);
  await page.setViewportSize({ ...MOBILE_VIEWPORT });

  await page.goto("/#");
  await expect(
    page.locator("[data-guide='contact-add-button']").first(),
  ).toBeVisible();

  await page.getByRole("button", { name: "Wallet" }).click();
  await page.waitForURL(/#wallet$/, { timeout: 10_000 });
  await expect(page.getByLabel("Available balance")).toBeVisible();

  await page.goto("/#profile");
  await page.waitForURL(/#profile$/, { timeout: 10_000 });
  await expect(page.locator(".profile-detail")).toBeVisible();

  await page.goto("/#");
  await page.getByRole("button", { name: "Menu" }).click();
  await page.waitForURL(/#settings$/, { timeout: 10_000 });
  await expect(page.getByRole("button", { name: /^Mint\b/ })).toBeVisible();

  await page.goto("/#");
  await page.locator("[data-guide='contact-add-button']").first().click();
  await page.waitForURL(/#contact\/new$/, { timeout: 10_000 });

  await page.locator("[data-guide='scan-contact-button']").click();
  const scanDialog = page.getByRole("dialog", { name: "Add contact" });
  await expect(scanDialog).toBeVisible();
  await scanDialog.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("dialog", { name: "Add contact" })).toHaveCount(
    0,
  );

  const searchInput = page.locator("[data-guide='contact-search-input']");
  await expect(searchInput).toBeVisible();
  await searchInput.fill(CONTACT_NPUB);
  await searchInput.press("Enter");
  await expect(
    page.getByRole("button", { name: "Add", exact: true }),
  ).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Add", exact: true }).click();

  await page.waitForURL(/#(?:contacts)?$/, { timeout: 10_000 });
  await expect(
    page.locator(".toast").filter({ hasText: "Contact saved" }),
  ).toBeVisible();

  const contactCards = page.locator("[data-guide='contact-card']");
  await expect
    .poll(async () => contactCards.count(), { timeout: 20_000 })
    .toBeGreaterThan(0);

  await contactCards.first().click();
  await page.waitForURL(/#chat\/[^/]+$/, { timeout: 10_000 });
  await expect(page.locator("[data-guide='chat-input']")).toBeVisible();

  const contactUrl = new URL(page.url());
  const contactMatch = contactUrl.hash.match(/^#chat\/([^/]+)$/);
  if (!contactMatch?.[1]) {
    throw new Error(`Could not parse contact id from ${contactUrl.hash}`);
  }
  const contactId = decodeURIComponent(contactMatch[1]);

  await page.goto(`/#contact/${encodeURIComponent(contactId)}`);
  await page.waitForURL(
    new RegExp(`#contact/${encodeURIComponent(contactId)}$`),
    {
      timeout: 10_000,
    },
  );
  await expect(page.locator("[data-guide='contact-message']")).toBeVisible();
  await expect(page.locator("[data-guide='contact-pay']")).toBeVisible();

  await page.locator("[data-guide='contact-message']").click();
  await page.waitForURL(new RegExp(`#chat/${contactId}$`), { timeout: 10_000 });
  await expect(page.locator("[data-guide='chat-input']")).toBeVisible();

  await page.getByRole("banner").getByRole("button", { name: "Close" }).click();
  await page.waitForURL(/#(?:contacts)?$/, { timeout: 10_000 });
  await page.getByRole("button", { name: "Wallet" }).click();
  await page.waitForURL(/#wallet$/, { timeout: 10_000 });
  await expect(page.getByLabel("Available balance")).toBeVisible();

  await page.goto(`/#contact/${encodeURIComponent(contactId)}/pay`);
  await page.waitForURL(
    new RegExp(`#contact/${encodeURIComponent(contactId)}/pay$`),
    {
      timeout: 10_000,
    },
  );

  await page.getByRole("button", { name: "1", exact: true }).click();
  await page.getByRole("button", { name: "0", exact: true }).click();
  const paySend = page.locator("[data-guide='pay-send']");
  await expect(paySend).toBeVisible();
  await expect(paySend).toBeDisabled();
});

test("supports chat reply, edit, reaction toggle, and copy actions", async ({
  page,
}) => {
  await setAuthenticatedStorage(page);
  await page.setViewportSize({ ...MOBILE_VIEWPORT });
  const contactId = await createContactAndOpenChat(page);

  const chatInput = page.locator("[data-guide='chat-input']");
  const sendButton = page.locator("[data-guide='chat-send']");
  await chatInput.fill("First message");
  await sendButton.click();
  await expect(
    page.locator(".chat-bubble").filter({ hasText: "First message" }),
  ).toBeVisible();

  await page
    .locator(".chat-message .chat-bubble")
    .filter({ hasText: "First message" })
    .first()
    .click({ button: "right" });
  await page.getByRole("button", { name: "Reply", exact: true }).click();
  const replyPreview = page.locator(".reply-preview");
  await expect(replyPreview).toContainText("Replying to");
  await expect(replyPreview).toContainText("First message");

  await chatInput.fill("Reply body");
  await sendButton.click();
  const replyBubble = page
    .locator(".chat-message")
    .filter({ hasText: "Reply body" })
    .first();
  await expect(replyBubble).toBeVisible();
  await expect(replyBubble).toHaveAttribute("data-reply-to-id", /.+/);
  await expect(replyBubble.locator(".chat-reply-quote")).toContainText(
    "First message",
  );

  await replyBubble.locator(".chat-bubble").click({ button: "right" });
  await page
    .getByRole("menu")
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  await chatInput.fill("Reply body edited");
  await page.getByRole("button", { name: "Save" }).click();
  const editedBubble = page
    .locator(".chat-message")
    .filter({ hasText: "Reply body edited" })
    .first();
  await expect(editedBubble).toContainText("edited");

  await editedBubble.locator(".chat-bubble").click({ button: "right" });
  await page
    .getByRole("listbox", { name: "Emoji picker" })
    .getByRole("button", { name: "👍", exact: true })
    .click();
  const reactionChip = editedBubble.locator(".reaction-chip", {
    hasText: "👍",
  });
  await expect(reactionChip).toBeVisible();
  await reactionChip.click();
  await expect(reactionChip).toHaveCount(0);

  await editedBubble.locator(".chat-bubble").click({ button: "right" });
  await page.getByRole("button", { name: "Copy", exact: true }).click();
  await expect(
    page.locator(".toast").filter({ hasText: "Copied to clipboard" }),
  ).toBeVisible();

  await page.goto(`/#contact/${encodeURIComponent(contactId)}/edit`);
  const archiveButton = page.getByRole("button", {
    name: "Archive contact",
    exact: true,
  });
  await archiveButton.click();
  await archiveButton.click();
  await page.waitForURL(/#(?:contacts)?$/, { timeout: 10_000 });

  await expect(page.locator("[data-guide='contact-card']")).toHaveCount(0);
  await page.goto(`/#contact/${encodeURIComponent(contactId)}`);
  await expect(
    page.getByText("Archived contact", { exact: true }),
  ).toBeVisible();
  await page.goto(`/#chat/${encodeURIComponent(contactId)}`);
  await expect(
    page.locator(".chat-message").filter({ hasText: "First message" }).first(),
  ).toBeVisible();
  await expect(editedBubble).toContainText("Reply body edited");
});

test("German settings, diagnostics, and profile routes keep their labels and back navigation", async ({
  page,
}) => {
  const errors = watchAppErrors(page, "German navigation");
  page.setDefaultTimeout(20_000);
  await page.setViewportSize(MOBILE_VIEWPORT);
  await setBaseStorage(page, "de");
  await setSeedLoginStorage(page, await createSeedIdentity());
  const banner = page.getByRole("banner");
  const title = banner.locator(".topbar-title");
  const close = banner.getByRole("button", { name: "Schließen", exact: true });

  await test.step("save a contact so diagnostic tables contain real changes", async () => {
    await createContactAndOpenChat(page, "Hinzufügen");
  });

  await test.step("open German settings from the wallet menu and inspect the mint", async () => {
    await page.goto("/#wallet");
    await expect(page.getByLabel("Verfügbares Guthaben")).toBeVisible();
    await banner.getByRole("button", { name: "Menü", exact: true }).click();
    await expect(page).toHaveURL(/#settings$/);
    await expect(title).toHaveText("Einstellungen");
    for (const name of [
      "Allgemein",
      "Zahlungen",
      "Netzwerk",
      "Sicherheit",
      "Debug",
    ]) {
      await expect(
        page.getByRole("heading", { name, exact: true }),
      ).toBeVisible();
    }
    await page.getByRole("button", { name: /^Mint\b/ }).click();
    await expect(page).toHaveURL(/#advanced\/mints$/);
    await expect(title).toHaveText("Mints");
    await expect(
      page.getByRole("button", { name: "localhost:3338 Test", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await close.click();
    await expect(page).toHaveURL(/#settings$/);
  });

  await test.step("open the local Nostr relay and return through its parent routes", async () => {
    await page.getByRole("button", { name: /^Nostr \d+\/\d+/ }).click();
    await expect(page).toHaveURL(/#nostr-relays$/);
    await expect(title).toHaveText("Nostr-Relay");
    await page.getByRole("button", { name: /ws:\/\/localhost:7777/ }).click();
    await expect(page).toHaveURL(/#nostr-relay\/ws%3A%2F%2Flocalhost%3A7777$/);
    await expect(title).toHaveText("Nostr-Relay");
    await expect(page.getByText("Status", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Löschen", exact: true }),
    ).toBeVisible();
    await close.click();
    await expect(page).toHaveURL(/#nostr-relays$/);
    await close.click();
    await expect(page).toHaveURL(/#settings$/);
  });

  await test.step("inspect Evolu server, current data, history, and capacity", async () => {
    await page.getByRole("button", { name: /^Evolu \d+\/\d+/ }).click();
    await expect(page).toHaveURL(/#evolu-servers$/);
    await expect(title).toHaveText("Evolu-Server");
    await page.getByRole("button", { name: /ws:\/\/localhost:4001/ }).click();
    await expect(page).toHaveURL(/#evolu-server\/ws%3A%2F%2Flocalhost%3A4001$/);
    await expect(
      page.getByText("Synchronisierung", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Offline gehen", exact: true }),
    ).toBeVisible();
    await close.click();
    await expect(page).toHaveURL(/#evolu-servers$/);
    await page.getByText("Daten", { exact: true }).click();
    await expect(page).toHaveURL(/#evolu-current-data$/);
    await expect(title).toHaveText("Daten");
    await expect(
      page.getByText("Eigentümerindex", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText("Änderungen bis zum Wechsel", { exact: true }).first(),
    ).toBeVisible();
    await close.click();
    await expect(page).toHaveURL(/#evolu-servers$/);
    await page.getByText("Verlauf", { exact: true }).click();
    await expect(page).toHaveURL(/#evolu-history-data$/);
    await expect(title).toHaveText("Verlauf");
    for (const name of ["Tabelle", "Spalte", "Wert", "Zeitstempel"]) {
      await expect(
        page.getByRole("columnheader", { name, exact: true }),
      ).toBeVisible();
    }
    await close.click();
    await expect(page).toHaveURL(/#evolu-servers$/);
    await page.goto("/#evolu-data");
    await expect(title).toHaveText("Daten");
    await expect(page.getByText(/^\d+\.\d % des 1-MiB-Limits$/)).toBeVisible();
  });

  await test.step("open and cancel profile editing through the topbar", async () => {
    await page.goto("/#profile");
    await expect(title).toHaveText("Profil");
    await banner
      .getByRole("button", { name: "Bearbeiten", exact: true })
      .click();
    await expect(page).toHaveURL(/#profile\/edit$/);
    await expect(title).toHaveText("Profil");
    await expect(page.locator("#profileName")).toBeVisible();
    await close.click();
    await expect(page).toHaveURL(/#profile$/);
    await expect(
      banner.getByRole("button", { name: "Bearbeiten", exact: true }),
    ).toBeVisible();
  });
  errors.assertClean();
});
