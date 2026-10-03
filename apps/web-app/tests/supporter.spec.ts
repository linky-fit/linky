/**
 * Supporter payments against the `supporter` service (Linky Bot) of the
 * docker stack: a Bronze donation from the dev mint comes back as a badge
 * that unlocks the Bronze theme and shows on the supporter's avatar for a
 * contact; a token from a mint outside the accepted list is refused and taken
 * back.
 *
 * Needs the docker stack up — see playwright.config.ts.
 */
import { expect, type Page } from "@playwright/test";
import { SUPPORTER_TIER_AMOUNTS } from "@linky-fit/supporter";
import {
  loadMintWallet,
  mintUrl,
  targetMintUrl,
  tokenOf,
} from "../../../packages/linkshu/tests/integration/helpers";
import { readBalanceSat } from "./helpers/appState";
import { addContactByNpub } from "./helpers/contacts";
import { shardRows } from "./helpers/linkyHooks";
import { enterAmount, test } from "./helpers/recurringPayments";
import { topUp } from "./helpers/wallet";

test.describe.configure({ mode: "parallel" });
test.use({ actionTimeout: 20_000 });

const BRONZE_SAT = SUPPORTER_TIER_AMOUNTS.bronze;
// Covers the mint's input fees on the payment and on the envelope it goes through.
const FUNDING_SAT = BRONZE_SAT + 100;
const REFUSED_TOKEN_SAT = 200;
const REFUSED_PAYMENT_SAT = 100;
// A send swap and the reclaim swap, each ceil(inputs / 10) sat.
const MAX_RECLAIM_FEES_SAT = 4;

const hashId = (page: Page, pattern: RegExp): string => {
  const id = new URL(page.url()).hash.match(pattern)?.[1];
  if (!id) throw new Error(`No contact id in ${page.url()}`);
  return decodeURIComponent(id);
};

/** Opens the Linky contact from Settings, taps Donate and returns Linky Bot's contact id. */
const openDonateFromLinkyContact = async (page: Page): Promise<string> => {
  await page.goto("/#settings");
  await page.getByRole("button", { name: "Feedback", exact: true }).click();
  await page.waitForURL(/#chat\/[^/]+$/, { timeout: 20_000 });
  const linkyId = hashId(page, /^#chat\/([^/]+)$/);
  await page.goto(`/#contact/${encodeURIComponent(linkyId)}`);
  await page.getByRole("button", { name: "Donate", exact: true }).click();
  await page.waitForURL(/#contact\/[^/]+\/donate$/, { timeout: 20_000 });
  const botId = hashId(page, /^#contact\/([^/]+)\/donate$/);
  expect(botId).not.toBe(linkyId);
  return botId;
};

const openChat = async (page: Page, contactId: string): Promise<void> => {
  await page.goto(`/#chat/${encodeURIComponent(contactId)}`);
};

const themeRow = (page: Page, name: string) =>
  page.getByRole("button", { name: new RegExp(`^${name}\\b`) });

const renderedTheme = (page: Page): Promise<string | undefined> =>
  page.evaluate(() => document.documentElement.dataset.theme);

const awardBadges = async (page: Page): Promise<string[]> =>
  (await shardRows(page, "supporter", "supporterAward"))
    .map((row) => String(row.badge))
    .sort();

const fundTargetToken = async (amountSat: number): Promise<string> => {
  const wallet = await loadMintWallet(targetMintUrl);
  const quote = await wallet.createMintQuoteBolt11(amountSat);
  const proofs = await wallet.mintProofsBolt11(amountSat, quote, undefined, {
    type: "random",
  });
  return tokenOf(proofs, targetMintUrl);
};

test("a Bronze donation unlocks the Bronze theme and shows its badge to contacts", async ({
  bootAccount,
}) => {
  const a = await bootAccount("A");
  const b = await bootAccount("B");
  const aOnB = await test.step("B saves A as a contact", () =>
    addContactByNpub(b.page, a.identity.npub));

  await test.step("A funds the dev mint", async () => {
    await topUp(a.page, FUNDING_SAT);
    await expect.poll(() => readBalanceSat(a.page)).toBe(FUNDING_SAT);
  });

  await test.step("Bronze is locked before the donation", async () => {
    await a.page.goto("/#settings/appearance");
    await expect(themeRow(a.page, "Bronze")).toContainText(
      "Unlocks with Bronze",
    );
  });

  const botId =
    await test.step("donate Bronze monthly from the dev mint", async () => {
      const id = await openDonateFromLinkyContact(a.page);
      await expect(
        a.page.getByRole("button", { name: /^Bronze\b/ }),
      ).toHaveAttribute("aria-selected", "true");
      await expect(
        a.page.getByRole("button", { name: new URL(mintUrl).host }),
      ).toHaveAttribute("aria-selected", "true");
      await expect(
        a.page.getByRole("switch", { name: "Every month" }),
      ).toBeChecked();
      await a.page
        .getByRole("button", { name: "Donate monthly", exact: true })
        .click();
      await expect(
        a.page.getByText(
          "Monthly payment set up. The first payment is on its way.",
        ),
      ).toBeVisible({ timeout: 60_000 });
      await expect(
        a.page.getByRole("button", { name: "Donate monthly", exact: true }),
      ).toBeDisabled();
      return id;
    });

  await test.step("the result lands in the Linky Bot conversation and stores both awards", async () => {
    await openChat(a.page, botId);
    await expect(
      a.page.getByText("Thank you! Your Bronze badge is stored.").first(),
    ).toBeVisible({ timeout: 60_000 });
    await expect.poll(() => awardBadges(a.page)).toEqual(["bronze", "generic"]);
  });

  await test.step("the Bronze theme unlocks and repaints the app", async () => {
    await a.page.goto("/#settings/appearance");
    const bronze = themeRow(a.page, "Bronze");
    await expect(bronze).not.toContainText("Unlocks with");
    await expect(themeRow(a.page, "Silver")).toContainText(
      "Unlocks with Silver",
    );
    await bronze.click();
    await expect(bronze).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => renderedTheme(a.page)).toBe("bronze");
  });

  await test.step("A shows the tier by default", async () => {
    await a.page.goto("/#settings/supporter-badge");
    await expect(
      a.page.getByRole("button", { name: /^Show tier\b/ }),
    ).toHaveAttribute("aria-selected", "true");
    await a.page.goto("/#profile");
    await expect(a.page.getByText("Bronze supporter")).toBeVisible();
  });

  await test.step("B sees the published Bronze badge on A", async () => {
    await b.page.goto("/#contacts");
    await expect(
      b.page
        .locator(`[data-guide='contact-card'][data-guide-contact-id='${aOnB}']`)
        .getByTestId("avatar-supporter-badge"),
    ).toBeVisible({ timeout: 60_000 });
    await b.page.goto(`/#contact/${encodeURIComponent(aOnB)}`);
    await expect(b.page.getByText("Bronze supporter")).toBeVisible();
    await expect(b.page.getByTestId("avatar-supporter-badge")).toBeVisible();
  });
});

test("a token from a mint outside the accepted list is refused and comes back", async ({
  bootAccount,
}) => {
  const a = await bootAccount("A");

  const before =
    await test.step("A holds sats only at a mint Linky Bot does not accept", async () => {
      await a.page.goto("/#wallet/token/new");
      await a.page
        .locator("textarea")
        .fill(await fundTargetToken(REFUSED_TOKEN_SAT));
      await a.page.waitForURL(/#wallet\/tokens$/);
      await a.page.goto("/#wallet");
      await expect
        .poll(() => readBalanceSat(a.page))
        .toBeGreaterThan(REFUSED_PAYMENT_SAT);
      return readBalanceSat(a.page);
    });

  const botId =
    await test.step("the donate screen offers no mint to pay from", async () => {
      const id = await openDonateFromLinkyContact(a.page);
      await expect(
        a.page.getByText("No accepted mint holds enough for this amount."),
      ).toBeVisible();
      await expect(
        a.page.getByRole("button", { name: "Donate monthly", exact: true }),
      ).toBeDisabled();
      return id;
    });

  await test.step("A pays Linky Bot from that mint as a plain contact payment", async () => {
    await a.page.goto(`/#contact/${encodeURIComponent(botId)}/pay`);
    await enterAmount(a.page, REFUSED_PAYMENT_SAT);
    await a.page.locator("[data-guide='pay-send']").click();
    await openChat(a.page, botId);
    await expect(
      a.page.getByText(`${REFUSED_PAYMENT_SAT} sat`, { exact: true }),
    ).toBeVisible();
  });

  await test.step("Linky Bot refuses it and the token comes back", async () => {
    await expect(
      a.page
        .getByText(
          "Linky Bot does not accept tokens from this mint. The payment is coming back to your wallet.",
        )
        .first(),
    ).toBeVisible({ timeout: 60_000 });
    await a.page.goto("/#wallet");
    await expect
      .poll(() => readBalanceSat(a.page), { timeout: 60_000 })
      .toBeGreaterThanOrEqual(before - MAX_RECLAIM_FEES_SAT);
    expect(await awardBadges(a.page)).toEqual([]);
  });
});
