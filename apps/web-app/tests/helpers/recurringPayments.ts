import {
  expect,
  test as base,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { Schema } from "effect";
import {
  mintUrl,
  targetMintUrl,
} from "../../../../packages/linkshu/tests/integration/helpers";
import {
  expectSingleLoad,
  MOBILE_VIEWPORT,
  readBalanceSat,
  setBaseStorage,
  waitForNetworkReady,
} from "./appState";
import { addContactByNpub } from "./contacts";
import { expectNoBootErrorPanel, watchAppErrors } from "./diagnostics";
import {
  createSeedIdentity,
  setSeedLoginStorage,
  type SeedIdentity,
} from "./identity";
import { stubFiatRates, stubThirdPartyAssets } from "./network";
import { topUp } from "./wallet";

interface Account {
  page: Page;
  identity: SeedIdentity;
}
interface BootOptions {
  identity?: SeedIdentity;
  hidden?: boolean;
  fiat?: boolean;
  /** Devices booted with one id all act on its claim. */
  deviceId?: string;
}
type BootAccount = (label: string, options?: BootOptions) => Promise<Account>;

export const test = base.extend<{ bootAccount: BootAccount }>({
  bootAccount: async ({ browser }, provideAccounts) => {
    const accounts: Array<
      Account & {
        errors: ReturnType<typeof watchAppErrors>;
        label: string;
      }
    > = [];
    try {
      await provideAccounts(async (label, options = {}) => {
        const identity = options.identity ?? (await createSeedIdentity());
        const context = await browser.newContext({
          serviceWorkers: "block",
          viewport: MOBILE_VIEWPORT,
        });
        const page = await context.newPage();
        const errors = watchAppErrors(page, label);
        accounts.push({ page, identity, errors, label });
        await setBaseStorage(page);
        await setSeedLoginStorage(page, identity);
        await page.addInitScript(
          ({ hidden, fiat, deviceId }) => {
            Object.defineProperty(document, "visibilityState", {
              configurable: true,
              get: () => (hidden ? "hidden" : "visible"),
            });
            Object.defineProperty(document, "hidden", {
              configurable: true,
              get: () => hidden,
            });
            if (fiat)
              localStorage.setItem(
                "linky.display_allowed_currencies.v1",
                JSON.stringify(["sat", "czk"]),
              );
            if (deviceId) localStorage.setItem("linky.device_id.v1", deviceId);
          },
          {
            hidden: options.hidden ?? false,
            fiat: options.fiat ?? false,
            deviceId: options.deviceId ?? null,
          },
        );
        await stubFiatRates(page);
        await stubThirdPartyAssets(page);
        await page.goto("/#wallet");
        await waitForNetworkReady(page);
        await expectNoBootErrorPanel(page, label);
        await expectSingleLoad(page, label);
        return { page, identity };
      });
    } finally {
      try {
        const results = await Promise.allSettled(
          accounts.map(async (account) => {
            account.errors.assertClean();
            await expectNoBootErrorPanel(account.page, account.label);
            await expectSingleLoad(account.page, account.label);
          }),
        );
        expect(
          results.filter((result) => result.status === "rejected"),
        ).toEqual([]);
      } finally {
        for (const { page } of accounts) await page.context().close();
      }
    }
  },
});

export const FUNDING_SAT = 100;
export const ORDER_SAT = 10;
// The envelope swap and the receiver each pay the mint's input fee.
export const MAX_FEE_SAT = 2;
/** The dev stack's default mint, which new recurring payments are bound to. */
export const MINT_HOST = new URL(mintUrl).host;

export const fundAndConnect = async (
  a: Account,
  b: Account,
  fund = true,
): Promise<string> => {
  if (fund) {
    await topUp(a.page, FUNDING_SAT);
    await expect.poll(() => readBalanceSat(a.page)).toBe(FUNDING_SAT);
  }
  const contactId = await addContactByNpub(a.page, b.identity.npub);
  await addContactByNpub(b.page, a.identity.npub);
  await b.page.goto("/#wallet");
  await expect.poll(() => readBalanceSat(b.page)).toBe(0);
  return contactId;
};

export const dateTimeLocal = (date: Date): string => {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export const enterAmount = async (
  page: Page,
  amount: number,
): Promise<void> => {
  for (const digit of String(amount)) {
    await page.getByRole("button", { exact: true, name: digit }).click();
  }
};

export const openForm = async (page: Page): Promise<void> => {
  await page.goto("/#wallet/transactions");
  await page.locator("[data-guide='recurring-add-button']").click();
  await expect(page).toHaveURL(/#wallet\/recurring\/new$/);
  await page.getByTestId("recurring-picker-contact").click();
};

export const saveOrder = async (
  page: Page,
  amount = ORDER_SAT,
  firstRun = new Date(Date.now() + 60_000),
): Promise<string> => {
  await enterAmount(page, amount);
  await page.getByRole("radio", { name: "Daily", exact: true }).click();
  await page
    .getByLabel("First payment", { exact: true })
    .fill(dateTimeLocal(firstRun));
  await page
    .getByRole("button", { name: "Set up recurring payment", exact: true })
    .click();
  await expect(page).toHaveURL(/#wallet\/transactions$/);
  const card = page.getByTestId("recurring-order-card");
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("daily");
  await card.click();
  await expect(page).toHaveURL(/#wallet\/recurring\/[^/]+$/);
  return new URL(page.url()).hash;
};

const OrderState = Schema.Struct({
  id: Schema.String,
  amount: Schema.Number,
  unit: Schema.String,
  rail: Schema.String,
  progress: Schema.parseJson(
    Schema.Struct({ runCount: Schema.Number, nextDueAtSec: Schema.Number }),
  ),
  claimAtSec: Schema.NullOr(Schema.Number),
  claimDeviceId: Schema.NullOr(Schema.String),
  lastRunStatus: Schema.NullOr(Schema.String),
});

/** The one recurring payment row, its progress spread out as `runCount` and `nextDueAtSec`. */
export const readOrder = async (page: Page) => {
  const rows = await page.evaluate(async () => {
    if (!window.__linkyE2E) throw new Error("Missing __linkyE2E");
    return window.__linkyE2E.shardRows("contacts", "recurringPayment");
  });
  expect(rows).toHaveLength(1);
  const { progress, ...order } = Schema.decodeUnknownSync(OrderState)(rows[0]);
  return { ...order, ...progress };
};

/** A Lightning address served by `serveLightningAddress`; no Nostr profile behind it. */
export const LIGHTNING_ADDRESS = "carol@lnurl.test";
/** The dev stack's second mint; its quotes stand in for the contact's invoices. */
const INVOICE_MINT_URL = targetMintUrl;

const json = (body: unknown) => ({
  status: 200,
  contentType: "application/json",
  headers: { "access-control-allow-origin": "*" },
  body: JSON.stringify(body),
});

/**
 * Answers `LIGHTNING_ADDRESS` (LNURL-pay) in the page with invoices from the
 * second dev mint and returns their quote ids. `invoices: false` makes every
 * invoice request fail.
 */
export const serveLightningAddress = async (
  page: Page,
  request: APIRequestContext,
  invoices = true,
): Promise<string[]> => {
  const quoteIds: string[] = [];
  await page.route("https://lnurl.test/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/.well-known/nostr.json") {
      return route.fulfill(json({ names: {} }));
    }
    if (url.pathname === "/.well-known/lnurlp/carol") {
      return route.fulfill(
        json({
          tag: "payRequest",
          callback: "https://lnurl.test/callback",
          minSendable: 1_000,
          maxSendable: 100_000_000,
          metadata: JSON.stringify([["text/plain", "Carol"]]),
        }),
      );
    }
    if (!invoices) return route.fulfill({ status: 500, body: "down" });
    const amountSat = Number(url.searchParams.get("amount")) / 1000;
    const response = await request.post(
      `${INVOICE_MINT_URL}/v1/mint/quote/bolt11`,
      { data: { amount: amountSat, unit: "sat" } },
    );
    const quote = Schema.decodeUnknownSync(
      Schema.Struct({ quote: Schema.String, request: Schema.String }),
    )(await response.json());
    quoteIds.push(quote.quote);
    return route.fulfill(json({ pr: quote.request, routes: [] }));
  });
  return quoteIds;
};

/** Whether the second dev mint saw the invoice of `quoteId` paid. */
export const invoicePaid = async (
  request: APIRequestContext,
  quoteId: string,
): Promise<boolean> => {
  const response = await request.get(
    `${INVOICE_MINT_URL}/v1/mint/quote/bolt11/${quoteId}`,
  );
  const { state } = Schema.decodeUnknownSync(
    Schema.Struct({ state: Schema.String }),
  )(await response.json());
  return state === "PAID" || state === "ISSUED";
};

/** Saves a contact that has only `LIGHTNING_ADDRESS`, so payments to it go over Lightning. */
export const addLightningContact = async (page: Page): Promise<void> => {
  await page.goto("/#contacts");
  await page.locator("[data-guide='contact-add-button']").first().click();
  await page.waitForURL(/#contact\/new$/);
  const search = page.locator("[data-guide='contact-search-input']");
  await search.fill(LIGHTNING_ADDRESS);
  await search.press("Enter");
  await page
    .getByRole("button", { name: "Create contact", exact: true })
    .click({ timeout: 30_000 });
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.waitForURL(/#(?:contacts)?$/, { timeout: 20_000 });
};

export const triggerSchedulerPass = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
    // Hidden devices do not tick on visibilitychange.
    if (document.hidden) window.dispatchEvent(new Event("online"));
  });
};

export const claimOrder = async (page: Page): Promise<number> => {
  await triggerSchedulerPass(page);
  await expect
    .poll(async () => (await readOrder(page)).claimAtSec)
    .not.toBeNull();
  const order = await readOrder(page);
  if (order.claimAtSec === null) throw new Error("Order was not claimed");
  return Math.max(order.nextDueAtSec, order.claimAtSec + 60);
};

export const waitUntil = async (epochSec: number): Promise<void> => {
  await expect
    .poll(() => Date.now(), {
      timeout: Math.max(20_000, epochSec * 1000 - Date.now() + 10_000),
      intervals: [250],
    })
    .toBeGreaterThanOrEqual(epochSec * 1000);
};

export const dueDialog = (page: Page) =>
  page.getByRole("dialog", { name: "Scheduled payment", exact: true });

export const waitForCountdown = async (
  page: Page,
  sendAt: number,
): Promise<void> => {
  await waitUntil(sendAt);
  await triggerSchedulerPass(page);
  await expect(dueDialog(page)).toBeVisible();
  await expect(dueDialog(page)).toContainText(
    "The daily recurring payment is ready.",
  );
};

export const expectReceived = async (
  page: Page,
  sats = ORDER_SAT,
): Promise<number> => {
  await expect
    .poll(() => readBalanceSat(page), { timeout: 60_000 })
    .toBeGreaterThanOrEqual(sats - MAX_FEE_SAT);
  const balance = await readBalanceSat(page);
  expect(balance).toBeLessThan(sats);
  return balance;
};

/** A detail row's value, which the row labels with its title. */
export const detailValue = (page: Page, label: string) =>
  page.getByLabel(label, { exact: true });

export const expectPaidHistory = async (
  page: Page,
  hash: string,
): Promise<void> => {
  await page.goto("/#wallet/transactions");
  const pill = page.getByTestId("transaction-recurring-pill");
  await expect(pill).toHaveCount(1);
  await page.getByTestId("transaction-card").filter({ has: pill }).click();
  await page
    .getByRole("button", { name: "Recurring payment", exact: true })
    .click();
  await expect.poll(() => new URL(page.url()).hash).toBe(hash);
  await expect(detailValue(page, "Payments made")).toHaveText("1");
  await expect(detailValue(page, "Last payment")).toContainText("paid");
};
