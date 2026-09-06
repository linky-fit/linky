import type { Page } from "@playwright/test";

/** Types the amount, opens the invoice, and leaves before the claim completes, exactly as a user would. */
export const topUp = async (page: Page, sats: number): Promise<void> => {
  await page.goto("/#wallet/topup");
  for (const digit of String(sats).split("")) {
    await page.getByRole("button", { exact: true, name: digit }).click();
  }
  await page.locator("[data-guide='topup-show-invoice']").click();
  await page.locator("img.qr").waitFor({ state: "visible", timeout: 60_000 });
  await page.goto("/#wallet");
};
