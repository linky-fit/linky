import type { Page } from "@playwright/test";

/** 1 CZK -> 40 sat, so the fixture's AM:1.00 CC:CZK is a round number. */
const CZK_PER_BTC = 2_500_000;
export const FIXTURE_AMOUNT_SAT = 40;

const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * Pin the BTC/fiat rate by routing the request rather than seeding the
 * `linky.fiat_rates.v1` cache, which would suppress the fetch and leave
 * fetchFiatRates — the only CZK->sat conversion in production —
 * unexercised. It returns null unless every currency is present and > 0.
 */
export const stubFiatRates = async (page: Page): Promise<void> => {
  await page.route("**/api.yadio.io/**", (route) =>
    route.fulfill({
      body: JSON.stringify({
        BTC: {
          BRL: CZK_PER_BTC,
          CHF: CZK_PER_BTC,
          CZK: CZK_PER_BTC,
          EUR: CZK_PER_BTC,
          USD: CZK_PER_BTC,
        },
      }),
      contentType: "application/json",
      // Without this the fulfilled cross-origin body is rejected by CORS and
      // rates stay null.
      headers: { "Access-Control-Allow-Origin": "*" },
      status: 200,
    }),
  );
};

/**
 * Keep third-party asset hosts off the network. fulfill(), never abort():
 * every contact gets a dicebear pictureUrl by default, and an abort logs a
 * console error per avatar per page.
 * Use serviceWorkers: "block": Playwright cannot intercept SW requests,
 * and src/sw.ts caches images with CacheFirst.
 */
export const stubThirdPartyAssets = async (page: Page): Promise<void> => {
  await page.route("**/api.dicebear.com/**", (route) =>
    route.fulfill({
      body: TRANSPARENT_PNG,
      contentType: "image/png",
      headers: { "Access-Control-Allow-Origin": "*" },
      status: 200,
    }),
  );

  await page.route("**/blossom.primal.net/**", (route) =>
    route.fulfill({
      body: TRANSPARENT_PNG,
      contentType: "image/png",
      headers: { "Access-Control-Allow-Origin": "*" },
      status: 200,
    }),
  );

  await page.route("**/fonts.googleapis.com/**", (route) =>
    route.fulfill({
      body: "",
      contentType: "text/css",
      headers: { "Access-Control-Allow-Origin": "*" },
      status: 200,
    }),
  );
};
