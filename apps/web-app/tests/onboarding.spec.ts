import { expect, test, type Page } from "@playwright/test";
import {
  MOBILE_VIEWPORT,
  readBalanceSat,
  setBaseStorage,
  waitForNetworkReady,
} from "./helpers/appState";
import { watchAppErrors } from "./helpers/diagnostics";
import { createSeedIdentity, setSeedLoginStorage } from "./helpers/identity";
import { stubFiatRates } from "./helpers/network";
import { topUp } from "./helpers/wallet";

const COPIED_TEXT_KEY = "e2e.copiedText";

/** Replaces the inert clipboard stub from setBaseStorage with a capturing one. */
const captureClipboard = async (page: Page): Promise<void> => {
  await page.addInitScript((key) => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          sessionStorage.setItem(key, text);
        },
      },
    });
  }, COPIED_TEXT_KEY);
};

const readCopiedText = (page: Page): Promise<string | null> =>
  page.evaluate((key) => sessionStorage.getItem(key), COPIED_TEXT_KEY);

const copyOnboardingLink = async (page: Page): Promise<string> => {
  await page.getByRole("button", { name: "Copy link" }).click();
  const copied = await readCopiedText(page);
  expect(copied).not.toBeNull();
  return copied ?? "";
};

test("onboarding QR hands a fresh signup the welcome gift", async ({
  browser,
}, testInfo) => {
  const newPage = async (label: string) => {
    const context = await browser.newContext({
      baseURL: testInfo.project.use.baseURL,
      viewport: MOBILE_VIEWPORT,
    });
    const page = await context.newPage();
    const errors = watchAppErrors(page, label);
    await setBaseStorage(page);
    await captureClipboard(page);
    await stubFiatRates(page);
    return { context, errors, page };
  };

  const onboarder = await newPage("onboarder");
  const newcomer = await newPage("newcomer");

  try {
    await setSeedLoginStorage(onboarder.page, await createSeedIdentity());
    await onboarder.page.goto("/#wallet");
    await waitForNetworkReady(onboarder.page);
    await topUp(onboarder.page, 512);
    await expect.poll(() => readBalanceSat(onboarder.page)).toBe(512);

    const onboardingLink =
      await test.step("onboarder issues the link with a 100 sat gift", async () => {
        await onboarder.page.goto("/#profile");
        await onboarder.page.getByRole("button", { name: "Onboard" }).click();
        await expect(onboarder.page).toHaveURL(
          /#profile\/onboard\/[A-Za-z0-9_-]+$/,
        );
        await expect(
          onboarder.page.getByText("The code includes a 100 sat welcome gift."),
        ).toBeVisible();
        const link = await copyOnboardingLink(onboarder.page);
        expect(link).toMatch(/^http:\/\/localhost:\d+\/#wallet\?cashu=cashu/);
        return link;
      });

    await test.step("newcomer opens the link, signs up and receives the gift", async () => {
      await newcomer.page.goto(onboardingLink);
      await newcomer.page
        .getByRole("button", { name: "Create a profile" })
        .click();
      await newcomer.page.getByRole("button", { name: "Continue" }).click();
      await newcomer.page
        .getByRole("button", { name: "Confirm profile" })
        .click();
      await waitForNetworkReady(newcomer.page);
      // The local mint charges input_fee_ppk 100, so the 3-proof 100 sat
      // gift nets 99 when the newcomer's wallet swaps it in.
      await expect
        .poll(() => readBalanceSat(newcomer.page), { timeout: 90_000 })
        .toBe(99);
    });

    await test.step("onboarder's page notices the claim and returns to the profile", async () => {
      await expect(onboarder.page).toHaveURL(/#profile$/, { timeout: 60_000 });
    });

    await test.step("without balance for the gift the code only opens the app", async () => {
      await newcomer.page.goto("/#profile");
      await newcomer.page.getByRole("button", { name: "Onboard" }).click();
      await expect(newcomer.page).toHaveURL(/#profile\/onboard$/);
      await expect(
        newcomer.page.getByText(
          "Not enough balance for the 100 sat welcome gift, the code only opens the app.",
        ),
      ).toBeVisible();
      expect(await copyOnboardingLink(newcomer.page)).toMatch(
        /^http:\/\/localhost:\d+\/$/,
      );
    });

    onboarder.errors.assertClean();
    newcomer.errors.assertClean();
  } finally {
    await onboarder.context.close();
    await newcomer.context.close();
  }
});
