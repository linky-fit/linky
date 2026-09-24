import { expect, test as base, type Page } from "@playwright/test";
import { Schema } from "effect";
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
          ({ hidden, fiat }) => {
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
          },
          { hidden: options.hidden ?? false, fiat: options.fiat ?? false },
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
// The source swap and the receiver each pay the mint's input fee.
export const MAX_FEE_SAT = 2;

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
  await page.locator(".transactions-page .contacts-fab").click();
  await expect(page).toHaveURL(/#wallet\/recurring\/new$/);
  await page.locator(".recurring-picker-list button").click();
};

export const saveOrder = async (
  page: Page,
  amount = ORDER_SAT,
  firstRun = new Date(Date.now() + 60_000),
): Promise<string> => {
  await enterAmount(page, amount);
  await page.getByRole("button", { name: "Daily", exact: true }).click();
  await page
    .getByLabel("First payment", { exact: true })
    .fill(dateTimeLocal(firstRun));
  await page
    .getByRole("button", { name: "Set up recurring payment", exact: true })
    .click();
  await expect(page).toHaveURL(/#wallet\/transactions$/);
  await expect(page.locator(".recurring-order-card")).toHaveCount(1);
  await expect(page.locator(".recurring-order-card")).toContainText("daily");
  await page.locator(".recurring-order-card").click();
  await expect(page).toHaveURL(/#wallet\/recurring\/[^/]+$/);
  return new URL(page.url()).hash;
};

const OrderState = Schema.Struct({
  id: Schema.String,
  amount: Schema.Number,
  unit: Schema.String,
  nextDueAtSec: Schema.Number,
  runCount: Schema.Number,
  claimAtSec: Schema.NullOr(Schema.Number),
  claimDeviceId: Schema.NullOr(Schema.String),
  lastRunStatus: Schema.NullOr(Schema.String),
});

export const readOrder = async (page: Page) => {
  const rows = await page.evaluate(async () => {
    if (!window.__linkyE2E) throw new Error("Missing __linkyE2E");
    return window.__linkyE2E.shardRows("transactions", "recurringPayment");
  });
  expect(rows).toHaveLength(1);
  return Schema.decodeUnknownSync(OrderState)(rows[0]);
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

export const detailValue = (page: Page, label: string) =>
  page
    .locator(".settings-row")
    .filter({ has: page.getByText(label, { exact: true }) })
    .locator(".settings-value");

export const expectPaidHistory = async (
  page: Page,
  hash: string,
): Promise<void> => {
  await page.goto("/#wallet/transactions");
  const pill = page.getByRole("button", {
    name: "Recurring payment",
    exact: true,
  });
  await expect(pill).toHaveCount(1);
  await expect(pill).toHaveClass(/transaction-recurring-pill/);
  await pill.click();
  await expect.poll(() => new URL(page.url()).hash).toBe(hash);
  await expect(detailValue(page, "Payments made")).toHaveText("1");
  await expect(detailValue(page, "Last payment")).toContainText("paid");
};
