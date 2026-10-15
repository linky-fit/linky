import { expect, test, type Page } from "@playwright/test";
import { nip19 } from "nostr-tools";
import { readBalanceSat, setBaseStorage } from "./helpers/appState";
import { addContactByNpub } from "./helpers/contacts";
import { createSeedIdentity, setSeedLoginStorage } from "./helpers/identity";
import { stubFiatRates, stubThirdPartyAssets } from "./helpers/network";
import { NOSTR_RELAY_URL } from "./helpers/stack";
import { watchNostrInbox } from "./helpers/relay";
import { shardRows } from "./helpers/linkyHooks";
import {
  ExternalWallet,
  mintToken,
  mintWallet,
  mintProofs,
} from "./helpers/externalWallet";
import {
  mintUrl,
  targetMintUrl,
} from "../../../packages/linkshu/tests/integration/helpers";

test.use({
  viewport: { width: 390, height: 844 },
  serviceWorkers: "block",
  ignoreHTTPSErrors: true,
});

const enterAmount = async (page: Page, amount: number) => {
  await page.getByRole("button", { name: "Clear form", exact: true }).click();
  for (const digit of String(amount))
    await page.getByRole("button", { name: digit, exact: true }).click();
};

const importFunds = async (page: Page, mint: string, amount: number) => {
  await page.goto("/#wallet/token/new");
  await page.locator("textarea").fill(await mintToken(mint, amount));
  await expect(page).toHaveURL(/#wallet\/tokens$/);
};

const chooseDefaultMint = async (page: Page, mint: string) => {
  await page.goto("/#advanced/mints/new");
  await page.getByLabel("Mint URL").fill(mint);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(
    page
      .getByTestId("mint-detail-badges")
      .getByText("Default", { exact: true }),
  ).toBeVisible();
};

const pasteRequest = async (page: Page, request: string) => {
  await page.goto("/#wallet");
  await page.evaluate((text) => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { readText: async () => text, writeText: async () => {} },
    });
  }, request);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Send", exact: true })
    .getByRole("button", { name: "Paste", exact: true })
    .click();
};

const scenarios = [
  { name: "1 nostr transport", mints: [mintUrl] },
  {
    name: "2 non-default mint first",
    mints: [mintUrl, targetMintUrl],
    fundBoth: true,
  },
  {
    name: "3 Lightning through a new mint",
    mints: [targetMintUrl],
    lightning: true,
  },
  { name: "4 POST transport", mints: [mintUrl], post: true },
  { name: "5 amountless request", mints: [mintUrl], amountless: true },
  { name: "6 P2PK locked request", mints: [mintUrl], locked: true },
] as const;

for (const scenario of scenarios) {
  test(`external wallet: ${scenario.name}`, async ({ page }, testInfo) => {
    const external = new ExternalWallet();
    await external.start(NOSTR_RELAY_URL);
    try {
      await setBaseStorage(page);
      await setSeedLoginStorage(page, await createSeedIdentity());
      await stubFiatRates(page);
      await stubThirdPartyAssets(page);
      const publishedRelays = new Map<string, Set<string>>();
      page.on("websocket", (socket) => {
        const relay = socket.url().replace(/\/$/, "");
        if (relay !== NOSTR_RELAY_URL && relay !== external.relayUrl) return;
        socket.on("framesent", ({ payload }) => {
          const frame: unknown = JSON.parse(String(payload));
          if (!Array.isArray(frame) || frame[0] !== "EVENT") return;
          const event: unknown = frame[1];
          if (
            typeof event !== "object" ||
            event === null ||
            !("id" in event) ||
            typeof event.id !== "string"
          )
            return;
          const relays = publishedRelays.get(event.id) ?? new Set<string>();
          relays.add(socket.url().replace(/\/$/, ""));
          publishedRelays.set(event.id, relays);
        });
      });
      await importFunds(page, mintUrl, 128);
      if ("fundBoth" in scenario) {
        await importFunds(page, targetMintUrl, 64);
        await page.goto(`/#advanced/mint/${encodeURIComponent(targetMintUrl)}`);
        await expect(page.getByLabel("Balance", { exact: true })).toContainText(
          "63",
        );
        await chooseDefaultMint(page, mintUrl);
        await expect(page.getByLabel("Balance", { exact: true })).toContainText(
          "127",
        );
      }
      if ("lightning" in scenario) {
        // Prove the real stack supports cross-mint Lightning before exercising Linky's fallback.
        const source = await mintWallet(mintUrl);
        const target = await mintWallet(targetMintUrl);
        const invoice = await target.createMintQuoteBolt11(4);
        const quote = await source.createMeltQuoteBolt11(invoice.request);
        const result = await source.meltProofsBolt11(
          quote,
          await mintProofs(mintUrl, 32),
        );
        test.skip(
          result.quote.state !== "PAID",
          `stack cross-mint melt returned ${result.quote.state}`,
        );
      }
      const amount = 8;
      const encoded = external.request({
        amount: "amountless" in scenario ? undefined : amount,
        mints: [...scenario.mints],
        post: "post" in scenario,
        locked: "locked" in scenario,
      });
      await testInfo.attach("external-request.txt", {
        body: encoded,
        contentType: "text/plain",
      });
      await pasteRequest(page, encoded);
      if ("amountless" in scenario) {
        await page.getByLabel("Amount", { exact: true }).fill(String(amount));
        await page
          .getByRole("button", { name: "Continue", exact: true })
          .click();
      }
      if ("lightning" in scenario) {
        await expect(
          page.getByText(
            `Pay through ${new URL(targetMintUrl).host}? It will be added to your mints.`,
            { exact: true },
          ),
        ).toBeVisible();
      }
      const send = page
        .getByRole("dialog", { name: "Confirm payment", exact: true })
        .getByRole("button", { name: "Pay", exact: true });
      // Scan payments above the auto-pay limit, HTTP, and amountless requests show confirmation.
      await expect
        .poll(
          async () =>
            external.posts.length +
            external.inbox.filter((message) => message.content.startsWith("{"))
              .length +
            (await send.count()),
        )
        .toBeGreaterThan(0);
      if (await send.count()) await send.click();
      await expect.poll(() => external.errors).toEqual([]);
      await expect
        .poll(
          () =>
            external.posts.length +
            external.inbox.filter((message) => message.content.startsWith("{"))
              .length,
          { timeout: 60_000 },
        )
        .toBeGreaterThan(0);
      const text =
        "post" in scenario
          ? external.posts[0].body
          : external.inbox.find((message) => message.content.startsWith("{"))!
              .content;
      await testInfo.attach("observed-payment.json", {
        body: text,
        contentType: "application/json",
      });
      const result = await external.validateAndRedeem(text, encoded, amount);
      await testInfo.attach("redemption.json", {
        body: JSON.stringify(result),
        contentType: "application/json",
      });
      expect
        .soft(result.mint)
        .toBe("fundBoth" in scenario ? targetMintUrl : scenario.mints[0]);
      if ("post" in scenario) {
        expect(external.posts[0].method).toBe("POST");
        expect(external.posts[0].contentType).toContain("application/json");
      } else {
        const wrapId = external.inbox.find(
          (message) => message.content === text,
        )!.wrapId;
        expect(publishedRelays.get(wrapId)).toContain(external.relayUrl);
        await expect
          .poll(() => publishedRelays.get(wrapId)?.has(NOSTR_RELAY_URL))
          .toBe(true);
      }
      // The payee nets the requested (or entered) amount after its input fee.
      expect(
        result.redeemed,
        `NUT-18 Input fees: face=${result.face}, fee=${result.fee}, requested=${amount}`,
      ).toBeGreaterThanOrEqual(amount);
    } finally {
      await external.close();
    }
  });
}

test("external wallet: 7 Linky QR and conversation requests, 8 bare token, 9 wrong id", async ({
  page,
}, testInfo) => {
  const external = new ExternalWallet();
  await external.start(NOSTR_RELAY_URL);
  try {
    const identity = await createSeedIdentity();
    const pubkey = nip19.decode(identity.npub);
    if (pubkey.type !== "npub") throw new Error("expected npub");
    const inboxReady = watchNostrInbox(page, identity.npub);
    await setBaseStorage(page);
    await setSeedLoginStorage(page, identity);
    await stubFiatRates(page);
    await stubThirdPartyAssets(page);
    // FakeWallet auto-settles invoices. Keep only this unpaid Lightning leg pending at the browser boundary.
    await page.routeWebSocket(
      (url) => url.port === new URL(mintUrl).port,
      (socket) => socket.close(),
    );
    await page.route("**/v1/mint/quote/bolt11/*", async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      await route.fulfill({
        response,
        json: { ...body, state: "UNPAID", paid: false },
      });
    });
    await page.goto("/#wallet");
    await expect(page.getByLabel("Available balance")).toBeVisible();
    await inboxReady();
    await chooseDefaultMint(page, targetMintUrl);
    await chooseDefaultMint(page, mintUrl);
    await addContactByNpub(page, nip19.npubEncode(external.pubkey));
    const conversationUrl = page.url();
    await page.goto("/#wallet/topup");
    await enterAmount(page, 8);
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            sessionStorage.setItem("test.nut18.clipboard", text);
          },
        },
      });
    });
    await page.locator('[data-guide="topup-show-invoice"]').click();
    await page.getByTestId("topup-invoice-copy").click();
    const copied = await page.evaluate(() =>
      sessionStorage.getItem("test.nut18.clipboard"),
    );
    expect(copied).toMatch(/^bitcoin:\?lightning=.+&creq=creqA/);
    const uri = new URL(copied!);
    expect(uri.searchParams.get("lightning")).toBeTruthy();
    const encoded = uri.searchParams.get("creq")!;
    const request = external.decodeLinkyRequest(encoded, {
      amount: 8,
      pubkey: pubkey.data,
      mints: [mintUrl, targetMintUrl],
      relay: NOSTR_RELAY_URL,
    });
    await testInfo.attach("linky-request.json", {
      body: JSON.stringify(request.toRawRequest(), (_key, value) =>
        typeof value === "bigint" ? Number(value) : value,
      ),
      contentType: "application/json",
    });

    await test.step("8 a bare token is received without completing the open topup", async () => {
      await external.sendText(
        pubkey.data,
        [NOSTR_RELAY_URL],
        await mintToken(mintUrl, 9),
      );
      await expect
        .poll(
          async () =>
            (await shardRows(page, "cashu", "cashuOperation")).filter(
              (row) => row.kind === "receive" && row.status === "done",
            ).length,
        )
        .toBe(1);
      await expect(page.getByTestId("topup-invoice-qr")).toBeVisible();
      await expect(page).toHaveURL(/#wallet\/topup\/invoice$/);
    });
    await test.step("9 a wrong request id receives funds without completing the topup", async () => {
      await external.pay(request, `wrong-${request.id}`);
      await expect
        .poll(
          async () =>
            (await shardRows(page, "cashu", "cashuOperation")).filter(
              (row) => row.kind === "receive" && row.status === "done",
            ).length,
        )
        .toBe(2);
      await expect(page.getByTestId("topup-invoice-qr")).toBeVisible();
      await expect(page).toHaveURL(/#wallet\/topup\/invoice$/);
    });
    await test.step("7 the matching payload completes the QR topup", async () => {
      await external.pay(request);
      await expect(page).toHaveURL(/#wallet$/);
      await expect.poll(() => readBalanceSat(page)).toBe(24);
    });
    await test.step("7 a conversation request is decoded and paid independently", async () => {
      await page.goto(conversationUrl);
      await page.locator('[data-guide="chat-request"]').click();
      await enterAmount(page, 8);
      await page.locator('[data-guide="request-send"]').click();
      await expect
        .poll(
          () =>
            external.inbox.filter((message) =>
              message.content.startsWith("creqA"),
            ).length,
        )
        .toBe(1);
      const chatRequest = external.decodeLinkyRequest(
        external.inbox.find((message) => message.content.startsWith("creqA"))!
          .content,
        {
          amount: 8,
          pubkey: pubkey.data,
          mints: [mintUrl, targetMintUrl],
          relay: NOSTR_RELAY_URL,
        },
      );
      const card = page.getByTestId("chat-payment-request-card");
      await expect(card).toHaveAttribute("data-status", "requested");
      await external.sendText(
        pubkey.data,
        [NOSTR_RELAY_URL],
        await mintToken(mintUrl, 9),
      );
      await expect
        .poll(
          async () =>
            (await shardRows(page, "cashu", "cashuOperation")).filter(
              (row) => row.kind === "receive" && row.status === "done",
            ).length,
        )
        .toBe(4);
      await expect(card).toHaveAttribute("data-status", "requested");
      await external.pay(chatRequest, `wrong-${chatRequest.id}`);
      await expect
        .poll(
          async () =>
            (await shardRows(page, "cashu", "cashuOperation")).filter(
              (row) => row.kind === "receive" && row.status === "done",
            ).length,
        )
        .toBe(5);
      await expect(card).toHaveAttribute("data-status", "requested");
      await external.pay(chatRequest);
      await expect(card).toHaveAttribute("data-status", "paid");
      await page.goto("/#wallet");
      await expect.poll(() => readBalanceSat(page)).toBe(48);
    });
  } finally {
    await external.close();
  }
});
