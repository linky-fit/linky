/**
 * Issued token → "Send to Contact" → pick a contact, two real app instances.
 *
 * A issues a token, opens its page, taps "Send to Contact" and picks B on the
 * contacts page; B receives the token as a chat message and the sats land in
 * B's wallet. Regression: the send handler used to hold the wallet transfer
 * list from before the token existed, so every pick failed with "Token is
 * invalid or already spent".
 *
 * Needs the docker stack up — see playwright.config.ts.
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
const TOKEN_SAT = 10;
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

test("an issued token can be handed to a contact from its page", async ({
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

  await test.step("A issues a token and sends it to B from the token page", async () => {
    await a.page.goto("/#wallet/token/emit");
    for (const digit of String(TOKEN_SAT).split("")) {
      await a.page.getByRole("button", { exact: true, name: digit }).click();
    }
    await a.page.getByRole("button", { exact: true, name: "Issue" }).click();
    await expect(a.page).toHaveURL(/#wallet\/token\/(?!emit$)[A-Za-z0-9_-]+$/);
    await a.page.getByRole("button", { name: "Send to Contact" }).click();
    await a.page.waitForURL(/#contacts$/);
    await a.page.locator("[data-guide='contact-card']").first().click();
    // The pick either opens B's chat with the token or reports a failure.
    await expect(a.page.getByText(/invalid or already spent/)).toHaveCount(0);
    await a.page.waitForURL(/#chat\/[^/]+$/);
  });

  await test.step("B receives the token", async () => {
    await b.page.goto("/#wallet");
    await expect
      .poll(() => readBalanceSat(b.page), { timeout: 60_000 })
      .toBeGreaterThanOrEqual(TOKEN_SAT - MAX_FEE_SAT);
    await a.page.goto("/#wallet");
    expect(await readBalanceSat(a.page)).toBeLessThanOrEqual(
      FUNDING_SAT - TOKEN_SAT,
    );
  });

  a.errors.assertClean();
  b.errors.assertClean();
  await a.context.close();
  await b.context.close();
});
