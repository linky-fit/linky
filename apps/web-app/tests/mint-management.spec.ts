/**
 * Mint management: the "Allow test mints" switch hides the local FakeWallet
 * mint's funds without touching them, the move form opens with the whole
 * balance, an explicit amount moves from :3338 to :3339 after its fee
 * estimate is shown, and the add button makes a typed mint the default.
 *
 * Needs the docker stack up — see "E2E tests" in AGENTS.md.
 */
import { expect, test, type Page } from "@playwright/test";
import {
  expectSingleLoad,
  MOBILE_VIEWPORT,
  readBalanceSat,
  setBaseStorage,
  waitForNetworkReady,
} from "./helpers/appState";
import { expectNoBootErrorPanel, watchAppErrors } from "./helpers/diagnostics";
import { createSeedIdentity, setSeedLoginStorage } from "./helpers/identity";
import { stubFiatRates, stubThirdPartyAssets } from "./helpers/network";
import { topUp } from "./helpers/wallet";
import {
  loadMintWallet,
  targetMintUrl,
  tokenOf,
} from "../../../packages/linkshu/tests/integration/helpers";

const SOURCE_MINT_URL = "http://localhost:3338";
const FUNDING_SAT = 100;
const TARGET_TOKEN_SAT = 16;
const MOVE_SAT = 30;

const fundTargetToken = async (amountSat: number): Promise<string> => {
  const wallet = await loadMintWallet(targetMintUrl);
  const quote = await wallet.createMintQuoteBolt11(amountSat);
  const proofs = await wallet.mintProofsBolt11(amountSat, quote, undefined, {
    type: "random",
  });
  return tokenOf(proofs, targetMintUrl);
};

const readMintBalanceSat = async (page: Page, mintUrl: string) => {
  await page.goto(`/#advanced/mint/${encodeURIComponent(mintUrl)}`);
  const text = await page.getByLabel("Balance", { exact: true }).innerText();
  return Number(text.replace(/[^0-9]/g, "") || "0");
};

const setAllowTestMints = async (page: Page, allow: boolean) => {
  await page.goto("/#settings");
  const toggle = page.getByRole("checkbox", { name: "Allow test mints" });
  await expect(toggle).toBeChecked({ checked: !allow });
  // The switch follows the synced setting, so it flips once the write lands.
  await toggle.click();
  await expect(toggle).toBeChecked({ checked: allow });
};

test("test mints can be hidden and funds move between mints", async ({
  browser,
}) => {
  const context = await browser.newContext({
    serviceWorkers: "block",
    viewport: { ...MOBILE_VIEWPORT },
  });
  const page = await context.newPage();
  const errors = watchAppErrors(page, "A");
  await setBaseStorage(page);
  await setSeedLoginStorage(page, await createSeedIdentity());
  await stubFiatRates(page);
  await stubThirdPartyAssets(page);
  await page.goto("/#wallet");
  await waitForNetworkReady(page);
  await expectNoBootErrorPanel(page, "A");
  await expectSingleLoad(page, "A");

  await test.step("fund the local test mint", async () => {
    await topUp(page, FUNDING_SAT);
    await expect.poll(() => readBalanceSat(page)).toBe(FUNDING_SAT);
    await expect(page.locator(".paid-overlay")).toHaveCount(0);
  });

  await test.step("turning test mints off hides their funds and the mint", async () => {
    await setAllowTestMints(page, false);
    await page.goto("/#wallet");
    await expect.poll(() => readBalanceSat(page)).toBe(0);
    await page.goto("/#advanced/mints");
    await expect(
      page.getByRole("button", { name: /localhost:3338/ }),
    ).toHaveCount(0);
  });

  await test.step("turning them back on reveals the untouched funds", async () => {
    await setAllowTestMints(page, true);
    await page.goto("/#wallet");
    await expect.poll(() => readBalanceSat(page)).toBe(FUNDING_SAT);
    await page.goto("/#advanced/mints");
    await expect(
      page.getByRole("button", { name: /^localhost:3338\b/ }),
    ).toHaveAttribute("aria-current", "true");
  });

  let targetBefore = 0;
  await test.step("receive a token at the target mint", async () => {
    await page.goto("/#wallet/token/new");
    await page
      .locator("textarea")
      .fill(await fundTargetToken(TARGET_TOKEN_SAT));
    // The import page moves to the token list once the receive settles.
    await page.waitForURL(/#wallet\/tokens$/);
    await expect
      .poll(() => readMintBalanceSat(page, targetMintUrl))
      .toBeGreaterThan(0);
    targetBefore = await readMintBalanceSat(page, targetMintUrl);
  });

  await test.step("estimate and move an explicit amount to the target mint", async () => {
    await page.goto(`/#advanced/mint/${encodeURIComponent(SOURCE_MINT_URL)}`);
    const moveForm = page.locator(".mint-move-form");
    await expect(moveForm.locator(".amount-number")).toHaveText(
      String(FUNDING_SAT),
    );
    await expect(moveForm).toContainText(`Maximum ${FUNDING_SAT} sat`);
    await page.getByLabel("To mint").selectOption({ label: "localhost:3339" });
    await page.getByRole("button", { name: "Clear form", exact: true }).click();
    for (const digit of String(MOVE_SAT)) {
      await page.getByRole("button", { exact: true, name: digit }).click();
    }
    await page
      .getByRole("button", { name: "Estimate fees", exact: true })
      .click();

    const estimate = page.getByLabel("Estimate fees", { exact: true });
    await expect(estimate).toContainText("Leaves this mint (at most)");
    await expect(estimate).toContainText(`${MOVE_SAT} sat`);
    const totalText = await estimate.locator("dd").last().innerText();
    const estimatedTotal = Number(totalText.replace(/[^0-9]/g, ""));
    expect(estimatedTotal).toBeGreaterThanOrEqual(MOVE_SAT);

    await page.getByRole("button", { name: "Move", exact: true }).click();
    await expect
      .poll(() => readMintBalanceSat(page, targetMintUrl), { timeout: 60_000 })
      .toBe(targetBefore + MOVE_SAT);
    const sourceAfter = await readMintBalanceSat(page, SOURCE_MINT_URL);
    expect(sourceAfter).toBeLessThanOrEqual(FUNDING_SAT - MOVE_SAT);
    expect(sourceAfter).toBeGreaterThanOrEqual(FUNDING_SAT - estimatedTotal);
  });

  await test.step("the add button makes a typed mint the default", async () => {
    await page.goto("/#advanced/mints");
    await page.getByRole("button", { name: "Add mint", exact: true }).click();
    await page.waitForURL(/#advanced\/mints\/new$/);
    // A bare host would get https:// prepended, which the local mint does not serve.
    await page.getByLabel("Mint URL").fill(targetMintUrl);
    await page.getByRole("button", { name: "Add", exact: true }).click();

    await page.waitForURL(/#advanced\/mint\//);
    await expect(page.locator(".mint-choice-badge.is-default")).toBeVisible();
    await page.goto("/#advanced/mints");
    await expect(
      page.getByRole("button", { name: /^localhost:3339\b/ }),
    ).toHaveAttribute("aria-current", "true");
  });

  errors.assertClean();
  await context.close();
});
