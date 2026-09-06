import { expect, test } from "@playwright/test";
import { getEncodedToken } from "@cashu/cashu-ts";
import { Schema } from "effect";
import {
  fundToken,
  loadMintWallet,
  targetMintUrl,
} from "../../../packages/linkshu/tests/integration/helpers";

test("an unlisted mint advertising simulated Lightning cannot consume a token", async ({
  page,
}) => {
  const source = await loadMintWallet();
  const original = await fundToken(64);
  const decoded = source.decodeToken(original);
  const token = getEncodedToken({
    ...decoded,
    mint: "https://unlisted-mint.example",
  });
  let invoiceRequests = 0;
  let meltRequests = 0;
  await page.route("https://unlisted-mint.example/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes("/melt")) meltRequests += 1;
    const response = await route.fetch({
      url: `http://localhost:3338${url.pathname}${url.search}`,
    });
    if (url.pathname === "/v1/info") {
      const info = Schema.decodeUnknownSync(
        Schema.parseJson(
          Schema.Record({ key: Schema.String, value: Schema.Unknown }),
        ),
      )(await response.text());
      return route.fulfill({
        response,
        json: {
          ...info,
          description: "Uses FakeWallet for simulated payments",
        },
      });
    }
    await route.fulfill({ response });
  });
  await page.route("https://site-lnurl.example/**", async (route) => {
    invoiceRequests += 1;
    await route.abort("failed");
  });
  await page.addInitScript(() => {
    localStorage.setItem("linky.lang", "en");
    localStorage.setItem("linky.display_currency.v1", "sat");
  });
  await page.goto("/cashu/");
  await page.locator("#cashu-token-input").fill(token);
  await page.locator(".cashu-form button[type=submit]").click();
  await expect(page.locator(".cashu-token-amount")).toContainText("64");
  await page.getByRole("button", { name: /Show options/ }).click();
  await page.locator("#cashu-ln-address").fill("alice@site-lnurl.example");
  await page.locator(".cashu-redeem-form button[type=submit]").click();
  await expect(page.locator(".cashu-status-error")).toContainText(
    "cannot send a real Lightning payment",
  );
  await expect(page.locator(".cashu-success-title")).toHaveCount(0);
  expect(invoiceRequests).toBe(0);
  expect(meltRequests).toBe(0);
  const states = await source.checkProofsStates(decoded.proofs);
  expect(states.every((state) => state.state === "UNSPENT")).toBe(true);
});

for (const mode of [
  "direct",
  "proxy",
  "interrupted",
  "swap-interrupted",
  "rejected",
] as const) {
  test(`redeem a token through ${mode} LNURL and preserve payment across reload`, async ({
    page,
  }) => {
    const token = await fundToken(64);
    const target = await loadMintWallet(targetMintUrl);
    const paidQuotes: string[] = [];
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem("linky.display_currency.v1", "sat");
      localStorage.setItem("linky.lang", "en");
    });
    let proxyCalls = 0;
    const metadata = JSON.stringify([["text/plain", "Site test"]]);
    const lnurlResponse = async (url: URL) => {
      const amount = url.searchParams.get("amount");
      if (!amount)
        return {
          tag: "payRequest",
          minSendable: 1000,
          maxSendable: 1_000_000,
          callback: "https://site-lnurl.example/invoice",
          metadata,
          commentAllowed: 100,
        };
      const quote = await target.createMintQuoteBolt11(Number(amount) / 1000);
      paidQuotes.push(quote.quote);
      return { pr: quote.request };
    };
    await page.route("https://site-lnurl.example/**", async (route) => {
      if (mode === "proxy") return route.abort("failed");
      await route.fulfill({
        json: await lnurlResponse(new URL(route.request().url())),
      });
    });
    await page.route("**/api/lnurlp?**", async (route) => {
      proxyCalls += 1;
      const url = new URL(route.request().url());
      expect(url.searchParams.get("address")).toBe("alice@site-lnurl.example");
      expect(url.searchParams.has("url")).toBe(false);
      await route.fulfill({ json: await lnurlResponse(url) });
    });
    let interrupted = false;
    let reloaded = false;
    let meltCalls = 0;
    let blockStateChecks = false;
    await page.route("http://localhost:3338/v1/checkstate", (route) =>
      blockStateChecks ? route.abort("failed") : route.continue(),
    );
    if (mode === "rejected") {
      await page.route(
        "http://localhost:3338/v1/melt/bolt11",
        async (route) => {
          if (route.request().method() !== "POST") return route.continue();
          meltCalls += 1;
          if (meltCalls > 1) return route.continue();
          await route.fulfill({
            status: 400,
            json: {
              code: 11000,
              detail: "not enough inputs provided for melt",
            },
          });
        },
      );
    }
    if (mode === "interrupted" || mode === "swap-interrupted") {
      await page.route(
        mode === "swap-interrupted"
          ? "http://localhost:3338/v1/swap"
          : "http://localhost:3338/v1/melt/bolt11",
        async (route) => {
          if (route.request().method() !== "POST" || interrupted)
            return route.continue();
          meltCalls += 1;
          const response = await route.fetch();
          expect(response.ok()).toBe(true);
          interrupted = true;
          await route.abort("failed");
        },
      );
      await page.route(
        "http://localhost:3338/v1/melt/quote/bolt11/*",
        (route) =>
          interrupted && !reloaded ? route.abort("failed") : route.continue(),
      );
    }
    await page.goto("/cashu/");
    await page.locator("#cashu-token-input").fill(token);
    await page.locator(".cashu-form button[type=submit]").click();
    await expect(page.locator(".cashu-token-amount")).toContainText("64");
    await page
      .getByRole("button", { name: /Show options|Další možnosti/ })
      .click();
    await page.locator("#cashu-ln-address").fill("alice@site-lnurl.example");
    await page.locator(".cashu-redeem-form button[type=submit]").click();
    if (mode === "interrupted" || mode === "swap-interrupted") {
      await expect.poll(() => interrupted, { timeout: 20_000 }).toBe(true);
      const invoiceCount = paidQuotes.length;
      await page.reload();
      reloaded = true;
      await expect(page.locator(".cashu-token-amount")).not.toContainText(
        "0 sat",
      );
      await page
        .getByRole("button", { name: /Show options|Další možnosti/ })
        .click();
      await page
        .locator("#cashu-ln-address")
        .fill(
          mode === "interrupted"
            ? "different@site-lnurl.example"
            : "alice@site-lnurl.example",
        );
      if (mode === "interrupted") {
        // The paid melt's inputs are only known spent once NUT-07 answers;
        // an unreachable check must not complete the payment with them as change.
        blockStateChecks = true;
        await page.locator(".cashu-redeem-form button[type=submit]").click();
        await expect(page.locator(".cashu-status-error")).toContainText(
          "Could not recover payment change",
        );
        blockStateChecks = false;
      }
      await page.locator(".cashu-redeem-form button[type=submit]").click();
      await expect(page.locator(".cashu-success-address")).toContainText(
        "alice@site-lnurl.example",
        { timeout: 45_000 },
      );
      if (mode === "interrupted") expect(paidQuotes).toHaveLength(invoiceCount);
      expect(meltCalls).toBe(1);
    }
    await expect(page.locator(".cashu-success-title")).toBeVisible({
      timeout: 45_000,
    });
    expect(paidQuotes.length).toBeGreaterThan(0);
    const source = await loadMintWallet();
    const states = await source.checkProofsStates(
      source.decodeToken(token).proofs,
    );
    expect(states.every((state) => state.state === "SPENT")).toBe(true);
    expect(errors).toEqual([]);
    if (mode === "proxy") expect(proxyCalls).toBeGreaterThan(1);
    if (mode === "interrupted") expect(interrupted).toBe(true);
    if (mode === "rejected") {
      expect(meltCalls).toBe(2);
      expect(paidQuotes.length).toBeGreaterThan(1);
    }
    await page.reload();
    await expect(page.locator("#cashu-token-input")).toBeVisible();
  });
}
