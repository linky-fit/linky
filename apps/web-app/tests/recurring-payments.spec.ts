/**
 * Standing orders (recurring payments) — happy path, two real app instances.
 *
 * A funds its wallet, adds B, and creates a standing order to B whose first
 * payment is already due. The background scheduler pays it on its next pass
 * (triggered here through the visibility hook rather than the 60 s timer): B
 * receives the "Standing order: <title>" chat note and the token, A's history
 * shows the run with the standing-order pill, and a second scheduler pass does
 * not pay again.
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

/** The scheduler also ticks when the tab becomes visible; no 60 s wait. */
const triggerSchedulerPass = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
};

test("a due standing order pays the contact once and shows up in history", async ({
  browser,
}) => {
  const a = await bootAccount(browser, "A");
  const b = await bootAccount(browser, "B");

  await test.step("A funds the wallet and saves B", async () => {
    await topUp(a.page, FUNDING_SAT);
    await expect.poll(() => readBalanceSat(a.page)).toBe(FUNDING_SAT);
    await addContactByNpub(a.page, b.identity.npub);
    await addContactByNpub(b.page, a.identity.npub);
  });

  await test.step("A creates an already-due order", async () => {
    const id = decodeURIComponent(
      new URL(a.page.url()).hash.replace(/^#chat\//, ""),
    );
    // Land on the contact pay page and follow the "Repeat regularly…" link,
    // which prefills the recipient and the typed amount.
    await a.page.goto(`/#contact/${encodeURIComponent(id)}/pay`);
    for (const digit of String(ORDER_SAT).split("")) {
      await a.page.getByRole("button", { exact: true, name: digit }).click();
    }
    await a.page.getByRole("button", { name: "Repeat regularly…" }).click();
    await a.page.waitForURL(/#wallet\/recurring\/new\?/);
    await expect(a.page.locator("#recurringAmount")).toHaveValue(
      String(ORDER_SAT),
    );
    await a.page.locator("#recurringTitle").fill("Coffee");
    await a.page.getByRole("button", { name: "hour(s)" }).click();
    await a.page
      .locator("#recurringFirstRun")
      .fill(dateTimeLocal(new Date(Date.now() - 2 * 60_000)));
    await a.page.getByRole("button", { name: "Create standing order" }).click();
    await a.page.waitForURL(/#wallet\/recurring$/);
    await expect(a.page.getByText("Coffee")).toBeVisible();
  });

  await test.step("the scheduler pays it on its next pass", async () => {
    await a.page.goto("/#wallet");
    await triggerSchedulerPass(a.page);
    await expect
      .poll(() => readBalanceSat(a.page), { timeout: 60_000 })
      .toBeLessThanOrEqual(FUNDING_SAT - ORDER_SAT);
    await b.page.goto("/#wallet");
    await expect
      .poll(() => readBalanceSat(b.page), { timeout: 60_000 })
      .toBeGreaterThanOrEqual(ORDER_SAT - MAX_FEE_SAT);
  });

  await test.step("B sees the chat note before the token", async () => {
    await b.page.goto("/#contacts");
    await b.page.locator("[data-guide='contact-card']").first().click();
    await b.page.waitForURL(/#chat\/[^/]+$/);
    await expect(b.page.getByText("Standing order: Coffee")).toBeVisible();
  });

  await test.step("A's history links the run to the order", async () => {
    await a.page.goto("/#wallet/transactions");
    const pill = a.page.getByRole("button", { name: "Standing order" }).first();
    await expect(pill).toBeVisible();
    await pill.click();
    await a.page.waitForURL(/#wallet\/recurring\/[^/]+$/);
    await expect(a.page.getByText("paid")).toBeVisible();
    await expect(a.page.getByText("Payments made")).toBeVisible();
    await expect(
      a.page.locator(".settings-row", { hasText: "Payments made" }),
    ).toContainText("1");
  });

  await test.step("a second pass does not pay again", async () => {
    await a.page.goto("/#wallet");
    const before = await readBalanceSat(a.page);
    await triggerSchedulerPass(a.page);
    await a.page.waitForTimeout(5_000);
    expect(await readBalanceSat(a.page)).toBe(before);
    await a.page.goto(`/#wallet/recurring`);
    await a.page.getByText("Coffee").click();
    await expect(
      a.page.locator(".settings-row", { hasText: "Payments made" }),
    ).toContainText("1");
  });

  a.errors.assertClean();
  b.errors.assertClean();
  await a.context.close();
  await b.context.close();
});
