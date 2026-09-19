/**
 * Recurring payments — happy path, two real app instances.
 *
 * A funds its wallet, saves B, and sets up a recurring payment to B from the
 * transaction history with the first payment already due. The scheduler
 * claims it and every device shows the upcoming payment with a countdown;
 * the test takes the banner's "Pay now" instead of waiting out the five-minute
 * notice. B receives the "Recurring payment" chat note and the token, A sees
 * the usual paid confirmation and a history pill that opens the payment, and a
 * second scheduler pass does not pay again.
 *
 * Needs the docker stack up — see "E2E tests" in CLAUDE.md.
 */
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
import { addContactByNpub } from "./helpers/contacts";
import { expectNoBootErrorPanel, watchAppErrors } from "./helpers/diagnostics";
import {
  createSeedIdentity,
  setSeedLoginStorage,
  type SeedIdentity,
} from "./helpers/identity";
import { stubFiatRates, stubThirdPartyAssets } from "./helpers/network";
import { topUp } from "./helpers/wallet";

const FUNDING_SAT = 100;
const ORDER_SAT = 10;
/** The local mint charges input_fee_ppk: 100, so B nets a little less. */
const MAX_FEE_SAT = 2;

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

const dateTimeLocal = (date: Date): string => {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

/** The scheduler also ticks when the tab becomes visible; no 15 s wait. */
const triggerSchedulerPass = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
};

test("a due recurring payment pays the contact once and shows up in history", async ({
  browser,
}) => {
  const a = await bootAccount(browser, "A");
  const b = await bootAccount(browser, "B");

  await test.step("A funds the wallet and both save each other", async () => {
    await topUp(a.page, FUNDING_SAT);
    await expect.poll(() => readBalanceSat(a.page)).toBe(FUNDING_SAT);
    await addContactByNpub(a.page, b.identity.npub);
    await addContactByNpub(b.page, a.identity.npub);
  });

  await test.step("A sets up an already-due payment from the history", async () => {
    await a.page.goto("/#wallet/transactions");
    await a.page.getByRole("button", { name: "New recurring payment" }).click();
    await a.page.waitForURL(/#wallet\/recurring\/new$/);
    await a.page.locator(".recurring-picker-list button").first().click();
    for (const digit of String(ORDER_SAT).split("")) {
      await a.page.getByRole("button", { exact: true, name: digit }).click();
    }
    await a.page.getByRole("button", { name: "Daily" }).click();
    await a.page.getByRole("button", { name: "Start and end" }).click();
    await a.page
      .locator("#recurringFirstRun")
      .fill(dateTimeLocal(new Date(Date.now() - 2 * 60_000)));
    await a.page
      .getByRole("button", { name: "Set up recurring payment" })
      .click();
    await a.page.waitForURL(/#wallet\/transactions$/);
    await expect(a.page.locator(".recurring-section")).toContainText(
      "every day",
    );
  });

  await test.step("the upcoming payment is announced and paid on request", async () => {
    await triggerSchedulerPass(a.page);
    const banner = a.page.locator(".recurring-upcoming-banner");
    await expect(banner).toContainText("recurring payment of", {
      timeout: 30_000,
    });
    await banner.getByRole("button", { name: "Pay now" }).click();
    await expect(a.page.getByText(/^Sent 10 sat to /)).toBeVisible({
      timeout: 60_000,
    });
    await expect(banner).toHaveCount(0);
    await a.page.goto("/#wallet");
    await expect
      .poll(() => readBalanceSat(a.page), { timeout: 60_000 })
      .toBeLessThanOrEqual(FUNDING_SAT - ORDER_SAT);
    await b.page.goto("/#wallet");
    await expect
      .poll(() => readBalanceSat(b.page), { timeout: 60_000 })
      .toBeGreaterThanOrEqual(ORDER_SAT - MAX_FEE_SAT);
  });

  await test.step("B sees the chat note", async () => {
    await b.page.goto("/#contacts");
    await b.page.locator("[data-guide='contact-card']").first().click();
    await b.page.waitForURL(/#chat\/[^/]+$/);
    await expect(
      b.page.getByText("Recurring payment", { exact: true }),
    ).toBeVisible();
  });

  await test.step("A's history links the run to the payment", async () => {
    await a.page.goto("/#wallet/transactions");
    const pill = a.page.locator(".transaction-recurring-pill").first();
    await expect(pill).toBeVisible();
    await pill.click();
    await a.page.waitForURL(/#wallet\/recurring\/[^/]+$/);
    await expect(
      a.page.locator(".settings-row", { hasText: "Payments made" }),
    ).toContainText("1");
    await expect(
      a.page.locator(".settings-row", { hasText: "Last payment" }),
    ).toContainText("paid");
  });

  await test.step("a second pass does not pay again", async () => {
    await a.page.goto("/#wallet");
    const before = await readBalanceSat(a.page);
    await triggerSchedulerPass(a.page);
    await a.page.waitForTimeout(5_000);
    expect(await readBalanceSat(a.page)).toBe(before);
    await expect(a.page.locator(".recurring-upcoming-banner")).toHaveCount(0);
  });

  a.errors.assertClean();
  b.errors.assertClean();
  await a.context.close();
  await b.context.close();
});
