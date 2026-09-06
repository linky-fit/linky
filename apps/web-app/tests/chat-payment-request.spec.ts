import { expect, test, type Page } from "@playwright/test";
import { Schema } from "effect";
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

test("incoming 2-sat requests recover a CDK output collision after local counters are lost", async ({
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
  const rejectedSwaps: number[] = [];
  let translatedCollisions = 0;
  let recoverySwapAttempts = 0;
  payer.page.on("response", (response) => {
    if (response.url().endsWith("/v1/swap") && !response.ok()) {
      rejectedSwaps.push(response.status());
    }
  });
  try {
    await topUp(payer.page, 50);
    await expect.poll(() => readBalanceSat(payer.page)).toBe(50);
    await addContactByNpub(payer.page, requester.identity.npub);
    await addContactByNpub(requester.page, payer.identity.npub);

    for (const paymentNumber of [1, 2]) {
      await test.step(`pay request ${paymentNumber} after reloading both wallets`, async () => {
        if (paymentNumber === 2) {
          await payer.page.route("**/v1/swap", async (route) => {
            const request = Schema.decodeUnknownSync(
              Schema.Struct({
                outputs: Schema.Array(Schema.Struct({ B_: Schema.String })),
              }),
            )(route.request().postDataJSON());
            recoverySwapAttempts += 1;
            const uniqueOutputs = new Set(
              request.outputs.map((output) => output.B_),
            );
            expect(
              uniqueOutputs.size,
              "each swap request has unique blinded outputs",
            ).toBe(request.outputs.length);
            const response = await route.fetch();
            const body: unknown = await response.json();
            if (
              !response.ok() &&
              Schema.is(Schema.Struct({ code: Schema.Number }))(body) &&
              body.code === 11003
            ) {
              translatedCollisions += 1;
              // CDK calls the same historical collision "Duplicate outputs".
              await route.fulfill({
                response,
                json: { code: 11008, detail: "Duplicate outputs" },
              });
              return;
            }
            await route.fulfill({ response });
          });
          const removedCounters = await payer.page.evaluate(() => {
            const keys = Object.keys(localStorage).filter((key) =>
              key.startsWith("linky.linkshu.value.linkshu.detCounter."),
            );
            for (const key of keys) localStorage.removeItem(key);
            return keys.length;
          });
          expect(removedCounters).toBeGreaterThan(0);
        }
        await payer.page.reload();
        await requester.page.reload();
        await requester.page.locator('[data-guide="chat-request"]').click();
        await requester.page
          .getByRole("button", { name: "Clear form", exact: true })
          .click();
        await requester.page
          .getByRole("button", { name: "2", exact: true })
          .click();
        await requester.page.locator('[data-guide="request-send"]').click();
        await expect(requester.page).toHaveURL(/#chat\/[^/]+$/);
        const incoming = payer.page.locator(".chat-payment-request-card");
        await expect(incoming).toHaveCount(paymentNumber);
        await expect(incoming.last()).toContainText("2 sat");
        await incoming
          .last()
          .getByRole("button", { name: "Pay", exact: true })
          .click();
        await expect(
          payer.page.locator(".chat-payment-request-status.is-paid"),
        ).toHaveCount(paymentNumber);
        await expect(
          requester.page.locator(".chat-payment-request-status.is-paid"),
        ).toHaveCount(paymentNumber);
        // The dev mint takes one sat for the payer swap and one for receipt.
        await expectBalance(payer.page, 50 - paymentNumber * 3);
        await expectBalance(requester.page, paymentNumber);
        await expect(payer.page.getByText(/Payment failed:/)).toHaveCount(0);
        await expect(requester.page.getByText(/Payment failed:/)).toHaveCount(
          0,
        );
      });
    }

    for (const account of accounts) {
      await account.page.reload();
      await expect(
        account.page.locator(".chat-payment-request-status.is-paid"),
      ).toHaveCount(2);
      await testInfo.attach(
        `${account === payer ? "payer" : "requester"} paid requests`,
        {
          body: await account.page.screenshot(),
          contentType: "image/png",
        },
      );
      account.errors.assertClean();
      await expectNoBootErrorPanel(account.page, "chat request payment");
    }
    expect(
      translatedCollisions,
      "the real mint rejected historical output reuse",
    ).toBeGreaterThan(0);
    expect(recoverySwapAttempts).toBeGreaterThan(translatedCollisions);
    expect(rejectedSwaps).toHaveLength(translatedCollisions);
  } finally {
    for (const account of accounts) await account.context.close();
  }
});
