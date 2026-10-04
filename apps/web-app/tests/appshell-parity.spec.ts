import { createSlip39Share } from "@linky-fit/identity";
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
import { EVOLU_RELAY_URL, NOSTR_RELAY_URL } from "./helpers/stack";
import { mintUrl } from "../../../packages/linkshu/tests/integration/helpers";

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

/** Counts React commits through the DevTools hook, which production React also calls. */
const countReactCommits = (page: Page) =>
  page.addInitScript(() => {
    Reflect.set(window, "e2eReactCommits", 0);
    Reflect.set(window, "__REACT_DEVTOOLS_GLOBAL_HOOK__", {
      supportsFiber: true,
      inject: () => 1,
      onCommitFiberRoot: () =>
        Reflect.set(
          window,
          "e2eReactCommits",
          Number(Reflect.get(window, "e2eReactCommits")) + 1,
        ),
    });
  });

/** A render loop commits without pause; a settled screen goes a whole poll interval without one. */
const expectRendersToSettle = async (page: Page) => {
  const commits = () =>
    page.evaluate(() => Number(Reflect.get(window, "e2eReactCommits")));
  let previous = await commits();
  expect(previous, "the DevTools hook saw no React commit").toBeGreaterThan(0);
  await expect
    .poll(
      async () => {
        const current = await commits();
        const settled = current === previous;
        previous = current;
        return settled;
      },
      { intervals: [250] },
    )
    .toBe(true);
};

const createContactAndOpenChat = async (
  page: Page,
  labels = { add: "Add", saved: "Contact saved." },
): Promise<string> => {
  await page.goto("/#");
  await page.locator("[data-guide='contact-add-button']").first().click();
  await page.waitForURL(/#contact\/new$/, { timeout: 10_000 });

  const searchInput = page.locator("[data-guide='contact-search-input']");
  await expect(searchInput).toBeVisible();
  await searchInput.fill(CONTACT_NPUB);
  await searchInput.press("Enter");
  await expect(
    page.getByRole("button", { name: labels.add, exact: true }),
  ).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: labels.add, exact: true }).click();

  await page.waitForURL(/#(?:contacts)?$/, { timeout: 20_000 });
  await expect(
    page.locator('[aria-live="polite"]').getByText(labels.saved),
  ).toBeVisible();
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

test("gates a signed-out wallet without render loops and restores from SLIP-39", async ({
  page,
}) => {
  const errors = watchAppErrors(page, "signed out");
  const slip39Share = await Effect.runPromise(createSlip39Share());
  await setBaseStorage(page);
  await countReactCommits(page);
  await page.setViewportSize({ ...MOBILE_VIEWPORT });

  await page.goto("/#wallet");
  await expect(
    page.getByRole("button", { name: "Create a profile" }),
  ).toBeVisible();
  await expect(page.locator("[data-guide='contact-add-button']")).toHaveCount(
    0,
  );
  await expectRendersToSettle(page);
  errors.assertClean();

  await page.getByRole("button", { name: "I already have a profile" }).click();
  await page.getByLabel("Keys").fill(slip39Share);
  const reloadFinished = page.waitForEvent("load");
  await page.getByRole("button", { name: "Continue" }).click();

  // Restore intentionally resets the route to contacts.
  await reloadFinished;
  await page.waitForURL(/#contacts$/, { timeout: 30_000 });
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
  await page.waitForURL(/#contacts$/, { timeout: 30_000 });
  await page.goto("/#wallet");
  await expect(page.getByLabel("Available balance")).toBeVisible({
    timeout: 30_000,
  });
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
    page.getByTestId("chat-bubble").filter({ hasText: "First message" }),
  ).toBeVisible();

  await page
    .getByTestId("chat-message")
    .getByTestId("chat-bubble")
    .filter({ hasText: "First message" })
    .first()
    .click({ button: "right" });
  await page.getByRole("button", { name: "Reply", exact: true }).click();
  const replyPreview = page.getByTestId("chat-compose");
  await expect(replyPreview).toContainText("Replying to");
  await expect(replyPreview).toContainText("First message");

  await chatInput.fill("Reply body");
  await sendButton.click();
  const replyBubble = page
    .getByTestId("chat-message")
    .filter({ hasText: "Reply body" })
    .first();
  await expect(replyBubble).toBeVisible();
  await expect(replyBubble).toHaveAttribute("data-reply-to-id", /.+/);
  await expect(replyBubble.getByTestId("chat-reply-quote")).toContainText(
    "First message",
  );

  await replyBubble.getByTestId("chat-bubble").click({ button: "right" });
  await page
    .getByRole("dialog", { name: "Message actions" })
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  await chatInput.fill("Reply body edited");
  await page.getByRole("button", { name: "Save" }).click();
  const editedBubble = page
    .getByTestId("chat-message")
    .filter({ hasText: "Reply body edited" })
    .first();
  await expect(editedBubble).toContainText("edited");

  await editedBubble.getByTestId("chat-bubble").click({ button: "right" });
  await page
    .getByRole("group", { name: "React" })
    .getByRole("button", { name: "👍", exact: true })
    .click();
  const reactionChip = editedBubble
    .getByTestId("message-reactions")
    .getByRole("button", { name: "👍" });
  await expect(reactionChip).toBeVisible();
  await reactionChip.click();
  await expect(reactionChip).toHaveCount(0);

  await editedBubble.getByTestId("chat-bubble").click({ button: "right" });
  await page.getByRole("button", { name: "Copy", exact: true }).click();
  await expect(
    page.locator('[aria-live="polite"]').getByText("Copied to clipboard"),
  ).toBeVisible();

  await page.goto(`/#contact/${encodeURIComponent(contactId)}/edit`);
  const archiveButton = page.getByRole("button", {
    name: "Archive contact",
    exact: true,
  });
  await archiveButton.click();
  await page.waitForURL(/#(?:contacts)?$/, { timeout: 10_000 });
  await expect(
    page.locator('[aria-live="polite"]').getByText("Contact archived."),
  ).toBeVisible();

  await expect(page.locator("[data-guide='contact-card']")).toHaveCount(0);
  await page.goto(`/#contact/${encodeURIComponent(contactId)}`);
  await expect(
    page.getByText("Archived contact", { exact: true }),
  ).toBeVisible();
  await page.goto(`/#chat/${encodeURIComponent(contactId)}`);
  await expect(
    page
      .getByTestId("chat-message")
      .filter({ hasText: "First message" })
      .first(),
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
  const title = banner.getByRole("heading");
  const close = banner.getByRole("button", { name: "Schließen", exact: true });

  const contactId =
    await test.step("open and close the scanner, then save a contact so diagnostic tables contain real changes", async () => {
      await page.goto("/#contact/new");
      await page.locator("[data-guide='scan-contact-button']").click();
      const scanDialog = page.getByRole("dialog", {
        name: "Kontakt hinzufügen",
      });
      await expect(scanDialog).toBeVisible();
      await scanDialog.getByRole("button", { name: "Schließen" }).click();
      await expect(scanDialog).toHaveCount(0);
      return createContactAndOpenChat(page, {
        add: "Hinzufügen",
        saved: "Kontakt gespeichert.",
      });
    });

  await test.step("open the contact's pay, detail and chat routes", async () => {
    const contactPath = `#contact/${encodeURIComponent(contactId)}`;
    await page.goto(`/${contactPath}/pay`);
    await page.getByRole("button", { name: "1", exact: true }).click();
    await page.getByRole("button", { name: "0", exact: true }).click();
    const paySend = page.locator("[data-guide='pay-send']");
    await expect(paySend).toBeVisible();
    await expect(paySend).toBeDisabled();

    await page.goto(`/${contactPath}`);
    await expect(page.locator("[data-guide='contact-pay']")).toBeVisible();
    await page.locator("[data-guide='contact-message']").click();
    await expect(page).toHaveURL(new RegExp(`#chat/${contactId}$`));
    await expect(page.locator("[data-guide='chat-input']")).toBeVisible();
    await close.click();
    await expect(page).toHaveURL(/#(?:contacts)?$/);
  });

  await test.step("open German settings from the bottom navigation and inspect the mint", async () => {
    const tabs = page.getByRole("tablist");
    await tabs.getByRole("tab", { name: "Wallet", exact: true }).click();
    await expect(page).toHaveURL(/#wallet$/);
    await expect(page.getByLabel("Verfügbares Guthaben")).toBeVisible();
    await tabs.getByRole("tab", { name: "Einstellungen", exact: true }).click();
    await expect(page).toHaveURL(/#settings$/);
    await expect(title).toHaveAccessibleName("Einstellungen");
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
    await expect(title).toHaveAccessibleName("Mints");
    await expect(
      page.getByRole("button", {
        name: new RegExp(`^${new URL(mintUrl).host}\\b`),
      }),
    ).toHaveAttribute("aria-selected", "true");
    await close.click();
    await expect(page).toHaveURL(/#settings$/);
  });

  await test.step("open the local Nostr relay and return through its parent routes", async () => {
    await page.getByRole("button", { name: /^Nostr \d+\/\d+/ }).click();
    await expect(page).toHaveURL(/#nostr-relays$/);
    await expect(title).toHaveAccessibleName("Nostr-Relays");
    await page.getByRole("button", { name: NOSTR_RELAY_URL }).click();
    await expect(page).toHaveURL(
      new RegExp(`#nostr-relay/${encodeURIComponent(NOSTR_RELAY_URL)}$`),
    );
    await expect(title).toHaveAccessibleName("Nostr-Relay");
    await expect(page.getByText("Status", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Von Linky empfohlen, daher bleibt es eingerichtet.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Löschen", exact: true }),
    ).toHaveCount(0);
    await close.click();
    await expect(page).toHaveURL(/#nostr-relays$/);
    await close.click();
    await expect(page).toHaveURL(/#settings$/);
  });

  await test.step("inspect Evolu server, current data, history, and capacity", async () => {
    await expect(
      page.getByRole("button", { name: "Chat-Speicher", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: /^Evolu \d+\/\d+/ }).click();
    await expect(page).toHaveURL(/#evolu-servers$/);
    await expect(title).toHaveAccessibleName("Evolu-Server");
    await page.getByRole("button", { name: EVOLU_RELAY_URL }).click();
    await expect(page).toHaveURL(
      new RegExp(`#evolu-server/${encodeURIComponent(EVOLU_RELAY_URL)}$`),
    );
    await expect(
      page.getByText("Synchronisierung", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("switch", { name: "Offline", exact: true }),
    ).toBeVisible();
    await close.click();
    await expect(page).toHaveURL(/#evolu-servers$/);
    await page
      .getByRole("button", { name: "Chat-Speicher", exact: true })
      .click();
    await expect(page).toHaveURL(/#advanced\/chat-storage$/);
    await expect(title).toHaveAccessibleName("Chat-Speicher");
    await expect(
      page.getByText("Erstellte Chat-Shards", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Alte Chat-Shards vergessen",
        exact: true,
      }),
    ).toBeDisabled();
    await close.click();
    await expect(page).toHaveURL(/#evolu-servers$/);
    await page.getByText("Daten", { exact: true }).click();
    await expect(page).toHaveURL(/#evolu-current-data$/);
    await expect(title).toHaveAccessibleName("Daten");
    await expect(
      page.getByText("Aktiver Shard", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Shard messages rotieren",
        exact: true,
      }),
    ).toBeVisible();
    await close.click();
    await expect(page).toHaveURL(/#evolu-servers$/);
    await page.getByText("Verlauf", { exact: true }).click();
    await expect(page).toHaveURL(/#evolu-history-data$/);
    await expect(title).toHaveAccessibleName("Verlauf");
    for (const name of ["Tabelle", "Spalte", "Wert", "Zeitstempel"]) {
      await expect(
        page.getByRole("columnheader", { name, exact: true }),
      ).toBeVisible();
    }
    await close.click();
    await expect(page).toHaveURL(/#evolu-servers$/);
    await page.goto("/#evolu-data");
    await expect(title).toHaveAccessibleName("Speicher");
    await expect(page.getByText(/^\d+\.\d % des 1-MiB-Limits$/)).toBeVisible();
  });

  await test.step("open and cancel profile editing through the topbar", async () => {
    await page.goto("/#profile");
    await expect(title).toHaveAccessibleName("Profil");
    await banner
      .getByRole("button", { name: "Bearbeiten", exact: true })
      .click();
    await expect(page).toHaveURL(/#profile\/edit$/);
    await expect(title).toHaveAccessibleName("Profil");
    await expect(page.locator("#profileName")).toBeVisible();
    await close.click();
    await expect(page).toHaveURL(/#profile$/);
    await expect(
      banner.getByRole("button", { name: "Bearbeiten", exact: true }),
    ).toBeVisible();
  });
  errors.assertClean();
});

test("keeps the composer visible on the first keyboard opening when iOS temporarily shrinks innerHeight", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 647 });
  await setAuthenticatedStorage(page);
  await createContactAndOpenChat(page);
  const editor = page.locator('[data-guide="chat-input"]');
  const composer = page.getByTestId("chat-compose");
  await editor.fill("First keyboard opening");

  // Replay the iOS SE standalone measurements: innerHeight briefly equals
  // visualViewport.height, but fixed elements still use the full layout height.
  // Deliver the resize after the focus retries to cover a cold keyboard start.
  await page.evaluate(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 450));
    const viewport = window.visualViewport;
    if (!viewport) throw new Error("Visual viewport is unavailable");
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 319,
    });
    Object.defineProperty(viewport, "height", {
      configurable: true,
      value: 319,
    });
    viewport.dispatchEvent(new Event("resize"));
    await new Promise(requestAnimationFrame);
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 647,
    });
  });

  const expectAboveKeyboard = async () => {
    for (const element of [editor, composer]) {
      await expect
        .poll(() =>
          element.evaluate((node) => node.getBoundingClientRect().top),
        )
        .toBeGreaterThanOrEqual(0);
      await expect
        .poll(() =>
          element.evaluate((node) => node.getBoundingClientRect().bottom),
        )
        .toBeLessThanOrEqual(319);
    }
  };
  await expectAboveKeyboard();

  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport, "height", {
      configurable: true,
      value: 647,
    });
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
    window.visualViewport?.dispatchEvent(new Event("resize"));
  });
  await expect(editor).toHaveText("First keyboard opening");
  await editor.focus();
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport, "height", {
      configurable: true,
      value: 319,
    });
    window.visualViewport?.dispatchEvent(new Event("resize"));
  });
  await expectAboveKeyboard();

  // Reload to restore native viewport properties before testing layout resize.
  await page.reload();
  await editor.focus();
  await page.setViewportSize({ width: 375, height: 319 });
  await expectAboveKeyboard();
});
