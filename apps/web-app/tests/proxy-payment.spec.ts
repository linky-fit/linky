/**
 * Proxy payment (bank payment offer) — happy path, three real app instances.
 *
 * A (offerer) scans a bank QR and offers it to two contacts. B accepts first
 * and wins the bank details; C accepts too and must end at accepted_by_other
 * without ever seeing them. B marks the bank payment paid, A confirms
 * settlement, and B receives sats.
 *
 * Needs the docker stack up — see "E2E tests" in CLAUDE.md.
 *
 * Two recipients, not one, is deliberate: with a single recipient the lease
 * lock and the sentCandidateKeys guard are dead code, so broadcasting the bank
 * details to every acceptor would keep a one-recipient test green.
 *
 * Not covered: induced failures (delivery ordering, multi-relay, resubscribe
 * bugs like 362313d), offer expiry (needs a Date.now seam), src/sw.ts
 * (service workers are blocked below), multi-mint candidate ordering,
 * npub.cash flows, EUR/bysquare payloads.
 */
import { createRequire } from "node:module";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import {
  expectSingleLoad,
  MOBILE_VIEWPORT,
  readBalanceSat,
  setBaseStorage,
  waitForNetworkReady,
} from "./helpers/appState";
import {
  addContactByNpub,
  waitForContactStatusFetched,
} from "./helpers/contacts";
import { expectNoBootErrorPanel, watchAppErrors } from "./helpers/diagnostics";
import {
  createSeedIdentity,
  setSeedLoginStorage,
  type SeedIdentity,
} from "./helpers/identity";
import {
  FIXTURE_AMOUNT_SAT,
  stubFiatRates,
  stubThirdPartyAssets,
} from "./helpers/network";
import { topUp } from "./helpers/wallet";
import { waitForProfileStatusOnRelay } from "./helpers/relay";
import {
  SPD_ACCOUNT,
  SPD_MESSAGE,
  SPD_PAYLOAD,
  SPD_QR_PNG_BASE64,
  SPD_VARIABLE_SYMBOL,
} from "./fixtures/bankPaymentQr";

/** A funds this much so the offer never trips the insufficient-balance guard. */
const FUNDING_SAT = 100;

/**
 * The local mint charges input_fee_ppk: 100 (it is not fee-free), so the
 * receiver nets slightly less than the offered amount.
 */
const MAX_REDEEM_FEE_SAT = 2;

interface Account {
  context: BrowserContext;
  errors: ReturnType<typeof watchAppErrors>;
  identity: SeedIdentity;
  label: string;
  page: Page;
}

const bootAccount = async (
  browser: Browser,
  label: string,
): Promise<Account> => {
  const identity = await createSeedIdentity();
  const context = await browser.newContext({
    // Playwright cannot intercept service-worker requests, and src/sw.ts
    // caches cross-origin images — with a SW active the dicebear/blossom stubs
    // below would silently stop applying.
    serviceWorkers: "block",
    viewport: { ...MOBILE_VIEWPORT },
  });

  const page = await context.newPage();
  const errors = watchAppErrors(page, label);

  await setBaseStorage(page);
  await setSeedLoginStorage(page, identity);
  await stubFiatRates(page);
  await stubThirdPartyAssets(page);

  await page.goto("/#wallet");
  await waitForNetworkReady(page);
  await expectNoBootErrorPanel(page, label);
  await expectSingleLoad(page, label);

  return { context, errors, identity, label, page };
};

/** Publish the NIP-38 CZK status, then prove it actually landed on the relay. */
const advertiseCzk = async (account: Account): Promise<void> => {
  await account.page.goto("/#profile");
  const chip = account.page.locator("button.profile-status-chip", {
    hasText: "CZK",
  });
  await expect(chip).toBeVisible();
  await chip.click();
  // Re-enabled and still pressed means the publish resolved without reverting.
  await expect(chip).toBeEnabled({ timeout: 30_000 });
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  await waitForProfileStatusOnRelay(account.identity.npub, "CZK");
};

const walletBalance = async (page: Page): Promise<number> => {
  const currentHash = new URL(page.url()).hash || "#wallet";
  await page.goto("/#wallet");
  const value = await readBalanceSat(page);
  if (currentHash !== "#wallet") await page.goto(`/${currentHash}`);
  return value;
};

const offerDetailUrl = (page: Page) =>
  new URL(page.url()).hash.match(
    /^#chat\/([^/]+)\/bank-payment-offer\/([^/]+)$/,
  );

test("proxy payment: bank details reach exactly one acceptor, who is paid in sats", async ({
  browser,
}, testInfo) => {
  const a = await bootAccount(browser, "A");
  const b = await bootAccount(browser, "B");
  const c = await bootAccount(browser, "C");
  const accounts = [a, b, c];

  try {
    await test.step("A funds a wallet", async () => {
      await topUp(a.page, FUNDING_SAT);
      await expect
        .poll(() => readBalanceSat(a.page), { timeout: 120_000 })
        .toBeGreaterThanOrEqual(FUNDING_SAT);
    });

    await test.step("B and C advertise CZK and it reaches the relay", async () => {
      await advertiseCzk(b);
      await advertiseCzk(c);
    });

    const offererChatByRecipientNpub = new Map<string, string>();

    // Ordering is load-bearing: an empty status query is cached as null and
    // never retried, so B and C must have their status on the relay before A
    // adds them as contacts.
    await test.step("A adds B and C", async () => {
      // One at a time: adding the second contact while the first's status fetch
      // is in flight loses that status (see waitForContactStatusFetched).
      offererChatByRecipientNpub.set(
        b.identity.npub,
        await addContactByNpub(a.page, b.identity.npub),
      );
      await waitForContactStatusFetched(a.page, b.identity.npub);
      offererChatByRecipientNpub.set(
        c.identity.npub,
        await addContactByNpub(a.page, c.identity.npub),
      );
      await waitForContactStatusFetched(a.page, c.identity.npub);
    });

    await test.step("B and C add A and sit in the chat", async () => {
      // ChatPage's auto-open effect bails on unknown contacts, so A must be a
      // real contact and the acceptors must sit on the chat route.
      const chatA = await addContactByNpub(b.page, a.identity.npub);
      await b.page.goto(`/#chat/${encodeURIComponent(chatA)}`);
      const chatAForC = await addContactByNpub(c.page, a.identity.npub);
      await c.page.goto(`/#chat/${encodeURIComponent(chatAForC)}`);
    });

    const offerId =
      await test.step("A scans the bank QR and offers it", async () => {
        await a.page.goto("/#wallet");
        // Only the Send entry point (scanEntryPoint === "send") lets the
        // scanner accept a bank payment.
        await a.page.getByRole("button", { name: "Send" }).click();

        // A headless camera failure does not close the scanner (only closeScan
        // does), so the hidden file input is still mounted and usable.
        await a.page.locator(".scan-overlay input[type=file]").setInputFiles({
          buffer: Buffer.from(SPD_QR_PNG_BASE64, "base64"),
          mimeType: "image/png",
          name: "spd-qr.png",
        });

        await a.page.waitForURL(/#wallet\/bank-payment\//, { timeout: 30_000 });

        // buildSpdRows renders ACC, X-VS and MSG from this fixture as rows;
        // AM/CC feed the header.
        await expect(a.page.locator(".bank-payment-row")).toHaveCount(3);

        const chips = a.page.locator("button.bank-payment-offer-contact");
        await expect(chips).toHaveCount(2, { timeout: 60_000 });
        await expect(chips.nth(0)).toHaveAttribute("aria-pressed", "true");
        await expect(chips.nth(1)).toHaveAttribute("aria-pressed", "true");

        // This exact label proves the recipient count, sufficient balance and
        // parsed fiat rates at once.
        const cta = a.page.getByRole("button", {
          name: "Ask 2 contacts to pay",
        });
        await expect(cta).toBeEnabled();
        await cta.click();

        await a.page.waitForURL(/#chat\/[^/]+\/bank-payment-offer\/[^/]+$/, {
          timeout: 60_000,
        });
        const match = offerDetailUrl(a.page);
        if (!match?.[1] || !match[2]) {
          throw new Error(`invalid offer detail URL ${a.page.url()}`);
        }
        return decodeURIComponent(match[2]);
      });

    await test.step("B accepts first, then C", async () => {
      // Both acceptors must be on the offer page before the first accept:
      // A's auto-responder terminates every other candidate the moment one
      // accept arrives, so an acceptor whose offer delivery lags the winner's
      // accept round-trip would (correctly) never auto-open and never get to
      // accept — the concurrent second accept this test exists for would
      // silently not happen.
      for (const account of [b, c]) {
        await account.page.waitForURL(
          new RegExp(`bank-payment-offer/${offerId}$`),
          { timeout: 120_000 },
        );
      }
      for (const account of [b, c]) {
        await account.page
          .getByRole("button", { name: "Accept", exact: true })
          .click();
      }
    });

    const { loser, winner } =
      await test.step("the auto-responder sends bank details to exactly one acceptor", async () => {
        // The payment rows are collapsed by default, so the rendered QR is
        // the winner's marker.
        const hasBankDetails = async (account: Account) =>
          (await account.page.locator(".bank-payment-offer-qr").count()) > 0;

        // Time-boxed so a broken first publish attempt is not hidden by the
        // responder's 30s retry loop.
        await expect
          .poll(
            async () => (await hasBankDetails(b)) || (await hasBankDetails(c)),
            { timeout: 90_000 },
          )
          .toBe(true);

        const bWon = await hasBankDetails(b);
        return { loser: bWon ? c : b, winner: bWon ? b : c };
      });

    await test.step("the loser never sees the bank details", async () => {
      await expect(loser.page.locator(".bank-payment-fields")).toHaveCount(0);
      await expect(loser.page.locator(".bank-payment-offer-qr")).toHaveCount(0);
      await expect(
        loser.page.getByText("Someone else accepted the offer first", {
          exact: false,
        }),
      ).toBeVisible({ timeout: 90_000 });

      const record = await a.page.evaluate(
        (id) =>
          localStorage.getItem(
            `linky.bank_payment_offer_spd.v1.${encodeURIComponent(id)}`,
          ),
        offerId,
      );
      expect(record, "A kept an SPD record for the offer").toBeTruthy();
      const parsed: unknown = JSON.parse(String(record));
      const sentTo =
        typeof parsed === "object" &&
        parsed !== null &&
        "sentCandidateKeys" in parsed
          ? parsed.sentCandidateKeys
          : undefined;
      expect(
        Array.isArray(sentTo) ? sentTo.length : -1,
        "bank details went to exactly one candidate",
      ).toBe(1);
    });

    await test.step("the winner received the payment info intact", async () => {
      await expect(
        winner.page.locator(".bank-payment-offer-qr-placeholder"),
      ).toHaveCount(0);

      await winner.page
        .getByRole("button", { name: "Payment details" })
        .click();
      const fields = winner.page.locator(".bank-payment-fields");
      await expect(fields).toContainText(SPD_ACCOUNT);
      await expect(fields).toContainText(SPD_VARIABLE_SYMBOL);
      await expect(fields).toContainText(SPD_MESSAGE);

      // Decode the rendered QR to prove the payload survived
      // offerer -> relay -> acceptor -> re-render byte for byte.
      await winner.page.addScriptTag({
        path: createRequire(import.meta.url).resolve("jsqr"),
      });
      const decoded = await winner.page.evaluate(async () => {
        const img = document.querySelector<HTMLImageElement>(
          "img.bank-payment-offer-qr",
        );
        if (!img) return null;
        await img.decode();
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const decode: unknown = Reflect.get(window, "jsQR");
        if (typeof decode !== "function") return null;
        const result: unknown = decode(data.data, canvas.width, canvas.height);
        return typeof result === "object" &&
          result !== null &&
          "data" in result &&
          typeof result.data === "string"
          ? result.data
          : null;
      });
      expect(decoded).toBe(SPD_PAYLOAD);
    });

    await test.step("the winner marks the bank payment paid", async () => {
      const paid = winner.page.getByRole("button", { name: "I paid" });
      await expect(paid).toBeEnabled();
      await paid.click();
      await expect(
        winner.page.getByText("Waiting for your sats", { exact: false }),
      ).toBeVisible({ timeout: 60_000 });
    });

    await test.step("A settles and the winner is paid in sats", async () => {
      const winnerChatId = offererChatByRecipientNpub.get(winner.identity.npub);
      if (!winnerChatId) throw new Error("winner chat not found");
      await a.page.goto(`/#chat/${encodeURIComponent(winnerChatId)}`);
      const settle = a.page.getByRole("button", {
        name: "Mark done",
      });
      await expect(settle).toBeVisible({ timeout: 120_000 });
      const offerCard = a.page.locator(".chat-bank-payment-offer-card", {
        has: settle,
      });
      await expect(
        offerCard.getByRole("button", { name: "Details" }),
      ).toBeVisible();
      await expect(
        a.page.getByText("Camera not available.", { exact: true }),
      ).toBeHidden();
      await testInfo.attach("mark payment done from chat", {
        body: await offerCard.screenshot(),
        contentType: "image/png",
      });

      // Park the winner on the wallet page and stay there: re-mounting the
      // settled offer detail triggers its auto-return-to-chat effect, which
      // races with (and can clobber) a subsequent goto to #wallet.
      await winner.page.goto("/#wallet");

      await expect(settle).toBeEnabled();
      await settle.click();
      await expect
        .poll(() => readBalanceSat(winner.page), { timeout: 240_000 })
        .toBeGreaterThan(0);

      const received = await readBalanceSat(winner.page);
      expect(received).toBeLessThanOrEqual(FIXTURE_AMOUNT_SAT);
      expect(received).toBeGreaterThanOrEqual(
        FIXTURE_AMOUNT_SAT - MAX_REDEEM_FEE_SAT,
      );

      const senderBalance = await walletBalance(a.page);
      expect(FUNDING_SAT - senderBalance).toBeGreaterThanOrEqual(
        FIXTURE_AMOUNT_SAT,
      );
    });

    await test.step("A's stored bank details are cleaned up", async () => {
      // Cleanup runs in the auto-responder effect, not inside settle, so poll.
      await expect
        .poll(
          () =>
            a.page.evaluate(
              (id) =>
                localStorage.getItem(
                  `linky.bank_payment_offer_spd.v1.${encodeURIComponent(id)}`,
                ),
              offerId,
            ),
          { timeout: 120_000 },
        )
        .toBeNull();
    });

    for (const account of accounts) {
      await expectSingleLoad(account.page, account.label);
      await expectNoBootErrorPanel(account.page, account.label);
      account.errors.assertClean();
    }
  } finally {
    for (const account of accounts) await account.context.close();
  }
});
