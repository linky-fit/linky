import type { Page } from "@playwright/test";

/**
 * Types the amount, opens the invoice, and leaves before the claim completes,
 * exactly as a user would. Waits for the mint quote rather than the QR: the
 * local FakeWallet mint reports a quote as paid on its first status poll, so
 * the QR can be replaced by the paid overlay within tens of milliseconds.
 */
export const topUp = async (page: Page, sats: number): Promise<void> => {
  await page.goto("/#wallet/topup");
  for (const digit of String(sats).split("")) {
    await page.getByRole("button", { exact: true, name: digit }).click();
  }
  const quoteCreated = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/v1/mint/quote/bolt11",
    { timeout: 60_000 },
  );
  await page.locator("[data-guide='topup-show-invoice']").click();
  await quoteCreated;
  await page.goto("/#wallet");
};
