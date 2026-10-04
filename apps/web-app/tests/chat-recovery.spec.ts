import { test, expect } from "@playwright/test";
import { setBaseStorage } from "./helpers/appState";
import { createSeedIdentity, setSeedLoginStorage } from "./helpers/identity";
import { addContactByNpub } from "./helpers/contacts";
import { stubFiatRates } from "./helpers/network";
import { watchAppErrors, expectNoBootErrorPanel } from "./helpers/diagnostics";

test("chat reaches a peer, edit and reaction survive reload with the service worker active", async ({
  browser,
}, testInfo) => {
  const errors: ReturnType<typeof watchAppErrors>[] = [];
  const accounts = [];
  const removalErrors: string[] = [];
  for (const label of ["sender", "receiver"]) {
    const context = await browser.newContext({
      baseURL: testInfo.project.use.baseURL,
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    errors.push(watchAppErrors(page, label));
    page.on("console", (message) => {
      if (message.text().includes("reaction removal write failed"))
        removalErrors.push(message.text());
    });
    const identity = await createSeedIdentity();
    await setBaseStorage(page);
    await setSeedLoginStorage(page, identity);
    await page.addInitScript(() => {
      localStorage.setItem("linky.seen_receipts_enabled_at_sec.v1", "1");
    });
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
          .getByTestId("chat-bubble")
          .filter({ hasText: "Audit smoke original" }),
      ).toBeVisible();
      await expect(
        a.page.locator('[data-testid="chat-message"][data-direction="out"]'),
      ).toHaveAttribute("data-seen", "true");
      const originalSecond = Math.floor(Date.now() / 1000);
      await expect
        .poll(() => Math.floor(Date.now() / 1000))
        .toBeGreaterThan(originalSecond);
      await a.page
        .getByTestId("chat-bubble")
        .filter({ hasText: "Audit smoke original" })
        .click({ button: "right" });
      await a.page
        .getByRole("dialog", { name: "Message actions" })
        .getByRole("button", { name: "Edit", exact: true })
        .click();
      await a.page
        .locator('[data-guide="chat-input"]')
        .fill("Audit smoke edited");
      await a.page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(
        b.page
          .getByTestId("chat-message")
          .filter({ hasText: "Audit smoke edited" }),
      ).toContainText("edited");
    });
    await expect(
      a.page.locator('[data-testid="chat-message"][data-direction="out"]'),
    ).toHaveAttribute("data-seen", "true");
    await test.step("reaction reaches peer and persists after reload", async () => {
      const received = b.page
        .getByTestId("chat-message")
        .filter({ hasText: "Audit smoke edited" });
      await received.getByTestId("chat-bubble").click({ button: "right" });
      await b.context.setOffline(true);
      await b.page
        .getByRole("group", { name: "React" })
        .getByRole("button", { name: "👍", exact: true })
        .click();
      await expect(
        b.page
          .getByTestId("message-reactions")
          .getByRole("button", { name: "👍" }),
      ).toBeVisible();
      await expect
        .poll(() =>
          b.page.evaluate(() => localStorage.getItem("linky.outbox") ?? ""),
        )
        .toContain('"reaction"');
      await b.page.reload();
      await b.context.setOffline(false);
      await expect(
        a.page
          .getByTestId("message-reactions")
          .getByRole("button", { name: "👍" }),
      ).toBeVisible();
      await expect(
        b.page
          .getByTestId("chat-message")
          .filter({ hasText: "Audit smoke edited" }),
      ).toBeVisible();
      await expect(
        b.page
          .getByTestId("message-reactions")
          .getByRole("button", { name: "👍" }),
      ).toBeVisible();
      await testInfo.attach("chat after reload", {
        body: await b.page.screenshot(),
        contentType: "image/png",
      });
    });
    await test.step("removing a reaction tolerates its self-echo and stays removed after reload", async () => {
      await b.page
        .getByTestId("message-reactions")
        .getByRole("button", { name: "👍" })
        .click();
      for (const account of accounts)
        await expect(
          account.page.getByTestId("message-reactions").getByRole("button"),
        ).toHaveCount(0);
      expect(removalErrors).toEqual([]);
      for (const account of accounts) {
        await account.page.reload();
        await expect(
          account.page.getByText("Audit smoke edited", { exact: true }),
        ).toBeVisible();
        await expect(
          account.page.getByTestId("message-reactions").getByRole("button"),
        ).toHaveCount(0);
      }
      expect(removalErrors).toEqual([]);
    });
    await test.step("a long unbroken message wraps and the newest message opens in view, scrolling up to the composer", async () => {
      const unbroken = "x".repeat(300);
      await a.page.locator('[data-guide="chat-input"]').fill(unbroken);
      await a.page.locator('[data-guide="chat-send"]').click();
      await expect(
        b.page.getByTestId("chat-bubble").filter({ hasText: unbroken }),
      ).toBeVisible();
      const log = b.page.getByRole("log");
      expect(
        await log.evaluate((list) => list.scrollWidth - list.clientWidth),
      ).toBeLessThanOrEqual(0);
      await b.page.reload();
      await expect(
        b.page.getByTestId("chat-bubble").filter({ hasText: unbroken }),
      ).toBeVisible();
      await expect
        .poll(() =>
          log.evaluate((list) => {
            const messages = list.querySelectorAll(
              '[data-testid="chat-message"]',
            );
            const last = messages[messages.length - 1];
            if (!last) return false;
            const visible = list.getBoundingClientRect();
            const message = last.getBoundingClientRect();
            return (
              message.top >= visible.top && message.bottom <= visible.bottom
            );
          }),
        )
        .toBe(true);
      const composerTop = await b.page
        .locator('[data-guide="chat-input"]')
        .evaluate((input) => input.getBoundingClientRect().top);
      const logBottom = await log.evaluate(
        (list) => list.getBoundingClientRect().bottom,
      );
      expect(Math.abs(logBottom - composerTop)).toBeLessThanOrEqual(1);
    });
    await test.step("the service worker controls the reloaded pages", async () => {
      for (const account of accounts)
        await expect
          .poll(() =>
            account.page.evaluate(
              () => navigator.serviceWorker.controller?.state,
            ),
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
