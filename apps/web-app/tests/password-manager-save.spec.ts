import { expect, test } from "@playwright/test";
import { MOBILE_VIEWPORT, setBaseStorage } from "./helpers/appState";
import { addContactByNpub } from "./helpers/contacts";
import { watchAppErrors } from "./helpers/diagnostics";
import { createSeedIdentity } from "./helpers/identity";
import { stubFiatRates } from "./helpers/network";

test("password save is inert and a new signup persists contacts and messages", async ({
  page,
}) => {
  const errors = watchAppErrors(page, "fresh signup");
  const nestedScriptRequests: string[] = [];
  await page.setViewportSize(MOBILE_VIEWPORT);
  await setBaseStorage(page);
  await stubFiatRates(page);
  page.on("request", (request) => {
    if (
      request.resourceType() === "script" &&
      request.frame() !== page.mainFrame()
    ) {
      nestedScriptRequests.push(request.url());
    }
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Create a profile" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(
    page.getByRole("button", { name: "Confirm profile" }),
  ).toBeVisible();

  const saveResponsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/password-save.html" &&
      response.request().method() === "POST",
  );
  await page.locator(".onboarding-password-save-form").evaluate((element) => {
    if (!(element instanceof HTMLFormElement)) {
      throw new Error("Expected password-save form");
    }
    element.requestSubmit();
  });

  const saveResponse = await saveResponsePromise;
  expect(saveResponse.status()).toBe(200);
  expect(saveResponse.headers()["content-type"]).toContain("text/html");
  await saveResponse.finished();
  const saveFrame = saveResponse.frame();
  expect(saveFrame.parentFrame()).toBe(page.mainFrame());
  await saveFrame.waitForURL("**/password-save.html");
  await expect(saveFrame.locator("html")).toHaveAttribute("lang", "en");
  await expect(saveFrame.locator("body")).toBeEmpty();
  await expect(saveFrame.locator("script, #root")).toHaveCount(0);
  expect(nestedScriptRequests).toEqual([]);

  await page.getByRole("button", { name: "Confirm profile" }).click();
  await expect(page.getByLabel("Available balance")).toBeVisible();
  expect(nestedScriptRequests).toEqual([]);

  const contact = await createSeedIdentity();
  const contactId = await addContactByNpub(page, contact.npub);
  const message = "First message after signing up";
  await page.locator('[data-guide="chat-input"]').fill(message);
  await page.locator('[data-guide="chat-send"]').click();
  await expect(
    page.locator(".chat-bubble").filter({ hasText: message }),
  ).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL(new RegExp(`#chat/${contactId}$`));
  await expect(
    page.locator(".chat-bubble").filter({ hasText: message }),
  ).toBeVisible();
  await page.goto("/#contacts");
  const contactCard = page.locator('[data-guide="contact-card"]');
  await expect(contactCard).toHaveCount(1);
  await contactCard.click();
  await expect(page).toHaveURL(new RegExp(`#chat/${contactId}$`));
  await expect(
    page.locator(".chat-bubble").filter({ hasText: message }),
  ).toBeVisible();
  errors.assertClean();
});
