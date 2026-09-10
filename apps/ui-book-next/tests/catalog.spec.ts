import { expect, test } from "@playwright/test";

test("compositions render and send a multiline draft locally", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByText("84,250", { exact: true })).toBeVisible();
  const composer = page.getByRole("textbox", {
    name: "Chat message",
    exact: true,
  });
  const send = page.getByRole("button", {
    name: "Send chat message",
    exact: true,
  });
  await expect(send).toBeDisabled();
  await composer.fill("   ");
  await expect(send).toBeDisabled();
  await expect(composer).toHaveJSProperty("tagName", "TEXTAREA");
  await composer.fill("Hello Anna\nDinner next week?");
  await expect(composer).toHaveValue("Hello Anna\nDinner next week?");
  await send.click();
  await expect(
    page.getByText("Hello Anna Dinner next week?", { exact: true }),
  ).toBeVisible();
  await expect(composer).toHaveValue("");
  await expect(send).toBeDisabled();
  expect(errors).toEqual([]);
});

test("attachment-only send and removal control send availability", async ({
  page,
}) => {
  await page.goto("/");
  const send = page.getByRole("button", {
    name: "Send chat message",
    exact: true,
  });
  await page
    .getByRole("button", { name: "Attach sample receipt", exact: true })
    .click();
  await expect(send).toBeEnabled();
  await page
    .getByRole("button", { name: "Remove dinner receipt", exact: true })
    .click();
  await expect(send).toBeDisabled();
  await page
    .getByRole("button", { name: "Attach sample receipt", exact: true })
    .click();
  await send.click();
  await expect(
    page.getByText("Dinner receipt.pdf · sample attachment", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Remove dinner receipt", exact: true }),
  ).toHaveCount(0);
});

test("search finds exports and clearing restores all groups", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "Find a component" })
    .fill("SelectField");
  const groups = page.getByRole("navigation", { name: "Component groups" });
  await expect(groups.getByRole("button")).toHaveCount(1);
  await groups.getByRole("button", { name: "Fields" }).click();
  await expect(
    page.getByRole("button", { name: "Contact group: Friends" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear component search" }).click();
  await expect(groups.getByRole("button")).toHaveCount(10);
  await page.getByRole("textbox", { name: "Search people" }).fill("Anna");
  await page.getByRole("button", { name: "Clear people search" }).click();
  await expect(
    page.getByRole("textbox", { name: "Search people" }),
  ).toHaveValue("");
});

test("theme switch changes the rendered canvas and preserves draft", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "Chat message", exact: true })
    .fill("Keep this draft");
  await expect(page.locator(".book")).toHaveCSS(
    "background-color",
    "rgb(2, 6, 23)",
  );
  await page.getByRole("button", { name: "Switch to light theme" }).click();
  await expect(page.locator(".book")).toHaveAttribute("data-theme", "light");
  await expect(page.locator(".book")).toHaveCSS(
    "background-color",
    "rgb(248, 250, 252)",
  );
  await expect(
    page.getByRole("textbox", { name: "Chat message", exact: true }),
  ).toHaveValue("Keep this draft");
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await expect(page.locator(".book")).toHaveAttribute("data-theme", "dark");
});

test("dialog traps keyboard focus, dismisses with Escape, and restores opener", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Feedback & dialogs" }).click();
  const opener = page.getByRole("button", {
    name: "Open example dialog",
    exact: true,
  });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "Add a contact" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Save sample contact" }).focus();
  await page.keyboard.press("Tab");
  await expect(
    dialog.getByRole("button", { name: "Close example dialog" }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    dialog.getByRole("button", { name: "Save sample contact" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("select updates its label, skips disabled option, and restores focus", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Component groups" })
    .getByRole("button", { name: "Fields", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Note", exact: true }),
  ).toHaveJSProperty("tagName", "TEXTAREA");
  await page.getByRole("button", { name: "Contact group: Friends" }).click();
  const dialog = page.getByRole("dialog", { name: "Contact group" });
  await expect(dialog.getByRole("button", { name: "Archived" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Family", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Contact group: Family" }),
  ).toBeFocused();
});

test("message actions disclose reply and reaction callbacks", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Dinner message actions", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Reply to dinner message", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Cancel reply" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel reply" }).click();
  await expect(page.getByRole("button", { name: "Cancel reply" })).toHaveCount(
    0,
  );
  await page
    .getByRole("button", { name: "Dinner message actions", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Like dinner message", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Heart, 2", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("disabled and sending composers cannot submit", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Component groups" })
    .getByRole("button", { name: "Messaging", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Disabled message", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Send disabled message", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("textbox", { name: "Sending message", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Send busy message", exact: true }),
  ).toBeDisabled();
});

test("payment outcomes remain distinct and retry enters pending", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Payments & wallet", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Payment complete", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Pending", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Payment pending", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Payment complete", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Failed", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Payment failed", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Try sample again" }).click();
  await expect(
    page.getByRole("heading", { name: "Payment pending", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Sample QR code", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Pay sample request", exact: true })
    .click();
  await expect(page.getByText("Request paid", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Pay sample request", exact: true }),
  ).toHaveCount(0);
});

test("mobile and 320px examples stay inside the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Narrow · 320px", exact: true })
    .click();
  for (const group of [
    "In context",
    "Fields",
    "People & lists",
    "Payments & wallet",
  ]) {
    await page
      .getByRole("navigation", { name: "Component groups" })
      .getByRole("button", { name: group, exact: true })
      .click();
    const fits = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    );
    expect(fits, `${group} should not overflow horizontally`).toBe(true);
  }
  await page
    .getByRole("navigation", { name: "Component groups" })
    .getByRole("button", { name: "Fields", exact: true })
    .click();
  const amount = page.getByRole("textbox", {
    name: "Amount to send",
    exact: true,
  });
  await expect(amount).toHaveJSProperty("tagName", "TEXTAREA");
  for (const value of ["123456789012", "1234567890123"]) {
    await amount.fill(value);
    await expect(amount).toHaveValue(value);
    await expect
      .poll(() =>
        amount.evaluate((element) => ({
          horizontal: element.scrollWidth <= element.clientWidth,
          vertical: element.scrollHeight <= element.clientHeight,
        })),
      )
      .toEqual({ horizontal: true, vertical: true });
  }
});

test("every component group renders without runtime errors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  const groups = page.getByRole("navigation", { name: "Component groups" });
  for (const name of [
    "In context",
    "Foundations",
    "Controls",
    "Fields",
    "People & lists",
    "Messaging",
    "Attachments",
    "Navigation",
    "Feedback & dialogs",
    "Payments & wallet",
  ]) {
    await groups.getByRole("button", { name, exact: true }).click();
    await expect(
      page.getByRole("heading", { name, exact: true }).first(),
    ).toBeVisible();
    await expect(page.locator(".example-frame").first()).toBeVisible();
  }
  expect(errors).toEqual([]);
});

for (const mode of ["dark", "light"]) {
  test(`composer preserves the demo's focused ${mode} appearance`, async ({
    page,
  }) => {
    await page.goto("/");
    if (mode === "light")
      await page.getByRole("button", { name: "Switch to light theme" }).click();
    const input = page.getByRole("textbox", {
      name: "Chat message",
      exact: true,
    });
    await input.click();
    await expect(input).toBeFocused();
    await expect(input).toHaveCSS("outline-style", "none");
    await expect(input).toHaveCSS("font-size", "14px");
    await expect(input).toHaveCSS("padding", "8px 4px");
    const frame = input.locator("..");
    await expect(frame).toHaveCSS("border-radius", "16px");
    await expect(frame).toHaveCSS("padding", "3px");
    await expect(frame).toHaveCSS("height", "52px");
    await expect(frame).toHaveCSS(
      "border-color",
      mode === "dark" ? "rgb(45, 212, 191)" : "rgb(15, 118, 110)",
    );
    const request = page.getByRole("button", { name: "Request", exact: true });
    const pay = page.getByRole("button", { name: "Pay Anna", exact: true });
    await expect(request).toHaveCSS(
      "background-color",
      mode === "dark" ? "rgb(15, 23, 42)" : "rgb(255, 255, 255)",
    );
    await expect(pay).toHaveCSS(
      "background-color",
      mode === "dark" ? "rgb(4, 47, 46)" : "rgb(204, 251, 241)",
    );
    await expect(request).toHaveCSS("border-radius", "999px");
    await expect(request).toHaveCSS("padding", "8px 14px");
    await expect(
      page.getByText("Sample conversation · no messages leave this device", {
        exact: true,
      }),
    ).toHaveCSS("font-size", "10px");
    const attachment = page
      .getByRole("button", { name: "Attach sample receipt", exact: true })
      .locator("svg");
    await expect(attachment).toHaveAttribute(
      "stroke",
      mode === "dark" ? "#94a3b8" : "#475569",
    );
    await input.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(input).toBeFocused();
    await expect(input).toHaveCSS("outline-style", "none");
    await expect(frame).toHaveCSS(
      "border-color",
      mode === "dark" ? "rgb(45, 212, 191)" : "rgb(15, 118, 110)",
    );
  });
}

test("composer sends once with Enter and keeps Shift+Enter as a newline", async ({
  page,
}) => {
  await page.goto("/");
  const input = page.getByRole("textbox", {
    name: "Chat message",
    exact: true,
  });
  await input.fill("Keyboard message");
  await input.press("Shift+Enter");
  await expect(input).toHaveValue("Keyboard message\n");
  await input.press("Enter");
  await expect(input).toHaveValue("");
  await expect(page.getByText("Keyboard message", { exact: true })).toHaveCount(
    1,
  );
});

test("fields and search use their themed borders without browser focus outlines", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Component groups" })
    .getByRole("button", { name: "Fields", exact: true })
    .click();
  const field = page.getByRole("textbox", {
    name: "Contact name",
    exact: true,
  });
  await field.click();
  await expect(field).toHaveCSS("outline-style", "none");
  await expect(field).toHaveCSS("border-color", "rgb(45, 212, 191)");
  const search = page.getByRole("textbox", {
    name: "Search people",
    exact: true,
  });
  await search.click();
  await expect(search).toHaveCSS("outline-style", "none");
  await expect(search.locator("..")).toHaveCSS(
    "border-color",
    "rgb(45, 212, 191)",
  );
});
