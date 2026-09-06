import { test, expect } from "@playwright/test";
import { setBaseStorage, readBalanceSat } from "./helpers/appState";
import { createSeedIdentity, setSeedLoginStorage } from "./helpers/identity";
import { addContactByNpub } from "./helpers/contacts";
import { stubFiatRates } from "./helpers/network";
import { watchAppErrors, expectNoBootErrorPanel } from "./helpers/diagnostics";

test("chat reaches a peer, edit and reaction survive reload, pending topup resumes with service worker active", async ({
  browser,
}, testInfo) => {
  const errors: ReturnType<typeof watchAppErrors>[] = [];
  const accounts = [];
  for (const label of ["sender", "receiver"]) {
    const context = await browser.newContext({
      baseURL: testInfo.project.use.baseURL,
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    errors.push(watchAppErrors(page, label));
    const identity = await createSeedIdentity();
    await setBaseStorage(page);
    await setSeedLoginStorage(page, identity);
    await stubFiatRates(page);
    await page.goto("/#wallet");
    await expect(page.getByLabel("Available balance")).toBeVisible();
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    accounts.push({ context, page, identity });
  }
  const [a, b] = accounts;
  try {
    await addContactByNpub(a.page, b.identity.npub);
    await addContactByNpub(b.page, a.identity.npub);
    await test.step("send and edit reach the second browser", async () => {
      await a.page
        .locator('[data-guide="chat-input"]')
        .fill("Audit smoke original");
      await a.page.locator('[data-guide="chat-send"]').click();
      await expect(
        b.page
          .locator(".chat-bubble")
          .filter({ hasText: "Audit smoke original" }),
      ).toBeVisible();
      await a.page
        .locator(".chat-bubble")
        .filter({ hasText: "Audit smoke original" })
        .click({ button: "right" });
      await a.page
        .getByRole("menu")
        .getByRole("button", { name: "Edit", exact: true })
        .click();
      await a.page
        .locator('[data-guide="chat-input"]')
        .fill("Audit smoke edited");
      await a.page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(
        b.page
          .locator(".chat-message")
          .filter({ hasText: "Audit smoke edited" }),
      ).toContainText("edited");
    });
    await test.step("reaction reaches peer and persists after reload", async () => {
      const received = b.page
        .locator(".chat-message")
        .filter({ hasText: "Audit smoke edited" });
      await received.locator(".chat-bubble").click({ button: "right" });
      await b.context.setOffline(true);
      await b.page
        .getByRole("listbox", { name: "Emoji picker" })
        .getByRole("button", { name: "👍", exact: true })
        .click();
      await expect(
        b.page.locator(".reaction-chip", { hasText: "👍" }),
      ).toBeVisible();
      await expect
        .poll(() =>
          b.page.evaluate(() => localStorage.getItem("linky.outbox") ?? ""),
        )
        .toContain('"reaction"');
      await b.page.reload();
      await b.context.setOffline(false);
      await expect(
        a.page.locator(".reaction-chip", { hasText: "👍" }),
      ).toBeVisible();
      await expect(
        b.page
          .locator(".chat-message")
          .filter({ hasText: "Audit smoke edited" }),
      ).toBeVisible();
      await expect(
        b.page.locator(".reaction-chip", { hasText: "👍" }),
      ).toBeVisible();
      await testInfo.attach("chat after reload", {
        body: await b.page.screenshot(),
        contentType: "image/png",
      });
    });
    await test.step("an interrupted topup claims after reload exactly once", async () => {
      await a.page.route("**/v1/mint/bolt11", (route) => route.abort());
      await a.page.goto("/#wallet/topup");
      await a.page.getByRole("button", { name: "5", exact: true }).click();
      await a.page.getByRole("button", { name: "0", exact: true }).click();
      await a.page.locator('[data-guide="topup-show-invoice"]').click();
      await expect(a.page.locator("img.qr")).toBeVisible();
      await expect
        .poll(() =>
          a.page.evaluate(() =>
            Object.keys(localStorage).some((key) =>
              key.includes("pendingTopup"),
            ),
          ),
        )
        .toBe(true);
      await a.page.reload();
      await a.page.unroute("**/v1/mint/bolt11");
      await a.page.goto("/#wallet");
      await expect
        .poll(() => readBalanceSat(a.page), { timeout: 90000 })
        .toBe(50);
      await a.page.reload();
      await expect.poll(() => readBalanceSat(a.page)).toBe(50);
      await testInfo.attach("wallet after recovery", {
        body: await a.page.screenshot(),
        contentType: "image/png",
      });
      await expect
        .poll(() =>
          a.page.evaluate(() => navigator.serviceWorker.controller?.state),
        )
        .toBe("activated");
    });
    for (const watcher of errors) watcher.assertClean();
    for (const account of accounts)
      await expectNoBootErrorPanel(account.page, "chat recovery");
  } finally {
    for (const account of accounts) await account.context.close();
  }
});
