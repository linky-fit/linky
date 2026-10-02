import { expect, test } from "@playwright/test";
import { MOBILE_VIEWPORT, setBaseStorage } from "./helpers/appState";
import { setRandomIdentityStorage } from "./helpers/identity";
import { stubFiatRates, stubThirdPartyAssets } from "./helpers/network";

test.use({ serviceWorkers: "block", viewport: MOBILE_VIEWPORT });

test("recommended relays stay configured while the user's own relays come and go", async ({
  page,
}) => {
  await setBaseStorage(page);
  await setRandomIdentityStorage(page);
  await stubFiatRates(page);
  await stubThirdPartyAssets(page);
  await page.addInitScript(() =>
    localStorage.setItem("linky.inspector_enabled", "true"),
  );
  await page.goto("/#evolu-relays");
  const rows = page.locator(".evolu-relay-list button");
  const recommended = rows.filter({ hasText: "ws://localhost:4001" });
  const custom = rows.filter({ hasText: "wss://sync.example.com" });
  const noBackupWarning = page.getByText(
    /Your app data is not being backed up or synced via Evolu/,
  );
  await expect(rows).toHaveCount(1);
  await expect(recommended).toContainText("Recommended");

  await recommended.click();
  await expect(
    page.getByText("Recommended by Linky, so it stays configured.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Remove relay", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Go offline", exact: true }).click();
  await page.goto("/#evolu-relays");
  await expect(noBackupWarning).toBeVisible();
  await page.reload();
  await expect(noBackupWarning).toBeVisible();

  await page.getByRole("button", { name: "Add relay", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Add relay", exact: true })
    .fill("wss://sync.example.com");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(rows).toHaveCount(2);
  await expect(custom).not.toContainText("Recommended");
  await expect(noBackupWarning).not.toBeVisible();
  await page.goto("/#advanced/inspector/timeline");
  await page
    .getByRole("searchbox", { name: "Filter rows" })
    .fill("evolu.serversChanged");
  await expect(
    page
      .getByText("Updated Evolu relays; reload required", { exact: true })
      .first(),
  ).toBeVisible();
  await page.goto("/#evolu-relays");
  await page.reload();
  await expect(rows).toHaveCount(2);

  await custom.click();
  for (let click = 0; click < 2; click += 1) {
    await page
      .getByRole("button", { name: "Remove relay", exact: true })
      .click();
  }
  await expect(page).toHaveURL(/#evolu-relays$/);
  await page.reload();
  await expect(rows).toHaveCount(1);
  await expect(recommended).toBeVisible();
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("linky.evoluServers.user.v1") ?? "null"),
    ),
  ).toEqual([]);
});
