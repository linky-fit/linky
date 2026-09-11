import { expect, test } from "@playwright/test";

for (const viewport of [
  { width: 390, height: 844 },
  { width: 1280, height: 900 },
]) {
  test(`demo chat, payment and receipt at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/demo");
    await expect(page.getByText("84,250", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Anna Novak", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Anna Novak", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("textbox", { name: "Message", exact: true })
      .fill("Dinner again next week?");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(
      page.getByText("Dinner again next week?", { exact: true }).last(),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "Message", exact: true }),
    ).toHaveValue("");
    await page.getByRole("button", { name: "Pay Anna", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Amount in sats", exact: true })
      .fill("1500");
    await page.getByRole("textbox", { name: "What's it for?" }).fill("Lunch");
    await page
      .getByRole("button", { name: "Pay 1,500 sats", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Sending payment", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Payment complete", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Go to wallet", exact: true })
      .click();
    await expect(page.getByText("82,750", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Receive", exact: true }).click();
    await expect(
      page.getByRole("img", {
        name: "QR code for a sample Linky payment request",
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Simulate receipt", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Funds received" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page.getByText("83,750", { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test("failure refunds funds, offline keeps drafts, request moves no funds", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/demo");
  await page
    .getByRole("button", { name: "Open settings", exact: true })
    .click();
  await page
    .getByRole("checkbox", { name: "Fail next payment", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", { name: "Fail next payment", exact: true }),
  ).toBeChecked();
  await page
    .getByRole("button", { name: "Close settings", exact: true })
    .click();
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page
    .getByRole("button", { name: "Use sample QR", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Pay 2,400 sats", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Payment didn't go through",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Go to wallet", exact: true }).click();
  await expect(page.getByText("84,250", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Open settings", exact: true })
    .click();
  await page.getByRole("checkbox", { name: "Offline", exact: true }).click();
  await page
    .getByRole("button", { name: "Close settings", exact: true })
    .click();
  await page.getByRole("button", { name: "Anna Novak", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Keep this draft");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Your draft is saved");
  await expect(
    page.getByRole("textbox", { name: "Message", exact: true }),
  ).toHaveValue("Keep this draft");
  await page
    .getByRole("button", { name: "Back to contacts", exact: true })
    .click();
  await page.getByRole("button", { name: "Wallet", exact: true }).click();
  await page
    .getByRole("button", { name: "Open settings", exact: true })
    .click();
  await page.getByRole("checkbox", { name: "Offline", exact: true }).click();
  await page
    .getByRole("button", { name: "Close settings", exact: true })
    .click();
  await page.getByRole("button", { name: "Anna Novak", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Message", exact: true }),
  ).toHaveValue("Keep this draft");
  await page.getByRole("button", { name: "Request", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Amount in sats", exact: true })
    .fill("500");
  await page
    .getByRole("button", { name: "Request 500 sats", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Request sent" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Back to chat", exact: true }).click();
  await expect(
    page.getByText("Awaiting payment", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Back to contacts", exact: true })
    .click();
  await page.getByRole("button", { name: "Wallet", exact: true }).click();
  await expect(page.getByText("84,250", { exact: true })).toBeVisible();
});

test("catalog links, new component previews and demo reset", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "Find a component" })
    .fill("Checkbox");
  await page
    .getByTestId("component-groups")
    .getByRole("button", { name: "Controls" })
    .click();
  const checkbox = page.getByRole("checkbox", {
    name: "Offline preview",
    exact: true,
  });
  await expect(checkbox).not.toBeChecked();
  await checkbox.focus();
  await page.keyboard.press("Space");
  await expect(checkbox).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "Disabled checked", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("checkbox", { name: "Disabled checked", exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "Disabled unchecked", exact: true }),
  ).not.toBeChecked();
  await page
    .getByRole("textbox", { name: "Find a component" })
    .fill("ImagePreview");
  await page
    .getByTestId("component-groups")
    .getByRole("button", { name: "Attachments" })
    .click();
  await expect(
    page.getByRole("img", { name: "Full portrait of Anna", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open demo app" }).click();
  await expect(page).toHaveURL(/\/demo$/);
  await page
    .getByRole("button", { name: "Open settings", exact: true })
    .click();
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await expect(page.getByTestId("demo")).toHaveCSS(
    "background-color",
    "rgb(248, 250, 252)",
  );
  await page
    .getByRole("button", { name: "Try empty account", exact: true })
    .click();
  await expect(
    page.getByText("Your activity starts here", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Add your first contact", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("New Friend");
  await page
    .getByRole("button", { name: "Group: Friends", exact: true })
    .click();
  await page.getByRole("button", { name: "Work", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Add contact", exact: true })
    .getByRole("button", { name: "Add contact", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "New Friend", exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Wallet", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Open settings", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Reset sample data", exact: true })
    .click();
  await expect(page.getByText("84,250", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Component catalog", exact: true })
    .click();
  await expect(page).toHaveURL(/\/$/);
});

test("image attachments load, replies and reactions stay local at 320px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/demo");
  await page.getByRole("button", { name: "Anna Novak", exact: true }).click();
  const picker = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: "Attach image or PDF", exact: true })
    .click();
  await (await picker).setFiles("assets/avatars/anna.png");
  await expect(
    page.getByRole("button", { name: "Remove anna.png", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page
    .getByRole("button", { name: "Open anna.png", exact: true })
    .click();
  const preview = page
    .getByRole("dialog")
    .getByRole("img", { name: "anna.png", exact: true });
  await expect(preview).toBeVisible();
  await expect(preview).toHaveJSProperty("complete", true);
  expect(
    await preview.evaluate(
      (element) =>
        element instanceof HTMLImageElement && element.naturalWidth > 0,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Close attachment", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Actions for Thanks for dinner! See you soon.",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Reply", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("See you!");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByText("See you!", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Actions for See you!", exact: true })
    .click();
  await page.getByRole("button", { name: "React", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Love, 1", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
