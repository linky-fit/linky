import { expect, test, type Page } from "@playwright/test";
import { readBalanceSat, setBaseStorage } from "./helpers/appState";
import { addContactByNpub } from "./helpers/contacts";
import { expectNoBootErrorPanel, watchAppErrors } from "./helpers/diagnostics";
import { createSeedIdentity, setSeedLoginStorage } from "./helpers/identity";
import { stubFiatRates } from "./helpers/network";
import { topUp } from "./helpers/wallet";

const expectBalance = async (page: Page, balance: number): Promise<void> => {
  const chatHash = new URL(page.url()).hash;
  await page.goto("/#wallet");
  await expect.poll(() => readBalanceSat(page)).toBe(balance);
  await page.goto(`/${chatHash}`);
};

test("an incoming 2-sat chat request is paid and both sides see it paid", async ({
  browser,
}, testInfo) => {
  const accounts = [];
  for (const label of ["payer", "requester"]) {
    const context = await browser.newContext({
      baseURL: testInfo.project.use.baseURL,
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    const errors = watchAppErrors(page, label);
    const identity = await createSeedIdentity();
    await setBaseStorage(page);
    await setSeedLoginStorage(page, identity);
    await stubFiatRates(page);
    await page.goto("/#wallet");
    await expect(page.getByLabel("Available balance")).toBeVisible();
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    accounts.push({ context, page, identity, errors });
  }
  const [payer, requester] = accounts;
  const paidCards = (page: Page) =>
    page.locator(
      '[data-testid="chat-payment-request-card"][data-status="paid"]',
    );
  try {
    await topUp(payer.page, 50);
    await expect.poll(() => readBalanceSat(payer.page)).toBe(50);
    await addContactByNpub(payer.page, requester.identity.npub);
    await addContactByNpub(requester.page, payer.identity.npub);

    await test.step("the requester asks for 2 sat and the payer pays", async () => {
      await requester.page.locator('[data-guide="chat-request"]').click();
      await requester.page
        .getByRole("button", { name: "Clear form", exact: true })
        .click();
      await requester.page
        .getByRole("button", { name: "2", exact: true })
        .click();
      await requester.page.locator('[data-guide="request-send"]').click();
      await expect(requester.page).toHaveURL(/#chat\/[^/]+$/);
      const incoming = payer.page.getByTestId("chat-payment-request-card");
      await expect(incoming).toHaveCount(1);
      await expect(incoming).toContainText(/2\s*sat/);
      await incoming.getByRole("button", { name: "Pay", exact: true }).click();
      await expect(paidCards(payer.page)).toHaveCount(1);
      await expect(paidCards(requester.page)).toHaveCount(1);
      // Paid renders before the send finishes and navigates back to chat.
      await expect(payer.page.locator('[data-guide="chat-pay"]')).toBeEnabled();
      // The dev mint takes one sat for the payer swap and one for receipt.
      await expectBalance(payer.page, 47);
      await expectBalance(requester.page, 1);
      await expect(payer.page.getByText(/Payment failed:/)).toHaveCount(0);
      await expect(requester.page.getByText(/Payment failed:/)).toHaveCount(0);
    });

    for (const account of accounts) {
      await account.page.reload();
      await expect(paidCards(account.page)).toHaveCount(1);
      account.errors.assertClean();
      await expectNoBootErrorPanel(account.page, "chat request payment");
    }
  } finally {
    for (const account of accounts) await account.context.close();
  }
});
