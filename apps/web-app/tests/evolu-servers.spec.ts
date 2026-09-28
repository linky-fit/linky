import { expect, test } from "@playwright/test";
import { MOBILE_VIEWPORT, setBaseStorage } from "./helpers/appState";
import { setRandomIdentityStorage } from "./helpers/identity";
import { stubFiatRates, stubThirdPartyAssets } from "./helpers/network";

test.use({ serviceWorkers: "block", viewport: MOBILE_VIEWPORT });

test("relay removals survive reload, including the final relay", async ({
  page,
}) => {
  await setBaseStorage(page);
  await setRandomIdentityStorage(page);
  await stubFiatRates(page);
  await stubThirdPartyAssets(page);
  await page.addInitScript(() =>
    localStorage.setItem("linky.inspector_enabled", "true"),
  );
  await page.goto("/#evolu-servers");
  const rows = page.locator(".evolu-server-list button");
  await expect(rows.first()).toBeVisible();
  const urls = await rows.locator(".relay-url").allTextContents();

  for (const url of [...urls].reverse()) {
    await rows.filter({ hasText: url }).click();
    await page.getByRole("button", { name: "Go offline", exact: true }).click();
    await page
      .getByRole("button", { name: "Remove server", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Remove server", exact: true })
      .click();
    await expect(page).toHaveURL(/#evolu-servers$/);
    await expect(rows.filter({ hasText: url })).toHaveCount(0);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Row counts", exact: true }),
    ).toBeVisible();
    await expect(rows.filter({ hasText: url })).toHaveCount(0);
  }
  await expect(
    page.getByText("No Evolu servers configured.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/Your app data is not being backed up or synced via Evolu/),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("linky.evoluServers.v1") ?? "null"),
    ),
  ).toEqual([]);

  await page.getByRole("button", { name: "Add server", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Add server", exact: true })
    .fill("wss://sync.example.com");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(rows).toHaveCount(1);
  await page.goto("/#advanced/inspector/timeline");
  await page
    .getByRole("searchbox", { name: "Filter rows" })
    .fill("evolu.serversChanged");
  await expect(
    page
      .getByText("Updated Evolu servers; reload required", { exact: true })
      .first(),
  ).toBeVisible();
  await page.goto("/#evolu-servers");
  await expect(
    page.getByText(/Your app data is not being backed up or synced via Evolu/),
  ).not.toBeVisible();
  await page.reload();
  await expect(rows).toHaveCount(1);
  await rows.first().click();
  await page.getByRole("button", { name: "Go offline", exact: true }).click();
  await page.goto("/#evolu-servers");
  await expect(
    page.getByText(/Your app data is not being backed up or synced via Evolu/),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText(/Your app data is not being backed up or synced via Evolu/),
  ).toBeVisible();
});
