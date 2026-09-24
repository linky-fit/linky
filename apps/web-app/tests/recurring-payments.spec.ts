import { expect } from "@playwright/test";
import { readBalanceSat } from "./helpers/appState";
import { FIXTURE_AMOUNT_SAT } from "./helpers/network";
import {
  claimOrder,
  dateTimeLocal,
  detailValue,
  dueDialog,
  enterAmount,
  expectPaidHistory,
  expectReceived,
  FUNDING_SAT,
  fundAndConnect,
  openForm,
  ORDER_SAT,
  readOrder,
  saveOrder,
  test,
  triggerSchedulerPass,
  waitForCountdown,
  waitUntil,
} from "./helpers/recurringPayments";
import { topUp } from "./helpers/wallet";

test.describe.configure({ mode: "parallel" });
test.use({ actionTimeout: 20_000 });

test("pay now consumes one period and history links back to the payment", async ({
  bootAccount,
}) => {
  const a = await bootAccount("A");
  const b = await bootAccount("B");
  await test.step("fund A and save both contacts", () => fundAndConnect(a, b));
  const hash =
    await test.step("create a daily payment from history", async () => {
      await openForm(a.page);
      return saveOrder(a.page);
    });
  await test.step("pay now and receive the sats after mint fees", async () => {
    await a.page.getByRole("button", { name: "Pay", exact: true }).click();
    await expect(
      a.page.getByRole("status", { name: /^Sent 10 sat to / }),
    ).toBeVisible({ timeout: 60_000 });
    await expectReceived(b.page);
    await expectPaidHistory(a.page, hash);
  });
  await test.step("another pass leaves balances and the run count unchanged", async () => {
    await a.page.goto("/#wallet");
    const balance = await readBalanceSat(a.page);
    expect(balance).toBeLessThanOrEqual(FUNDING_SAT - ORDER_SAT);
    expect(balance).toBeGreaterThanOrEqual(FUNDING_SAT - ORDER_SAT - 2);
    const received = await readBalanceSat(b.page);
    await triggerSchedulerPass(a.page);
    await a.page.waitForTimeout(5_000);
    expect(await readBalanceSat(a.page)).toBe(balance);
    expect(await readBalanceSat(b.page)).toBe(received);
    await expectPaidHistory(a.page, hash);
    expect((await readOrder(a.page)).nextDueAtSec).toBeGreaterThan(
      Date.now() / 1000,
    );
  });
});

for (const action of ["Pay", "countdown expires", "Cancel this payment"]) {
  test(`due countdown: ${action}`, async ({ bootAccount }) => {
    const a = await bootAccount("A");
    const b = await bootAccount("B");
    await test.step("fund A and create a due payment", async () => {
      await fundAndConnect(a, b);
      await openForm(a.page);
    });
    const hash = await saveOrder(a.page);
    const sendAt =
      await test.step("wait for the persisted claim and its notice window", () =>
        claimOrder(a.page));
    await test.step("show the countdown in the visible app", () =>
      waitForCountdown(a.page, sendAt));
    await test.step(action, async () => {
      const appearedAt = Date.now();
      if (action !== "countdown expires") {
        await dueDialog(a.page)
          .getByRole("button", { name: action, exact: true })
          .click();
      }
      if (action === "Cancel this payment") {
        await expect(dueDialog(a.page)).toBeHidden();
        await expect(detailValue(a.page, "Last payment")).toContainText(
          "skipped",
        );
        expect((await readOrder(a.page)).nextDueAtSec).toBeGreaterThan(sendAt);
        await a.page.goto("/#wallet/transactions");
        await expect(a.page.locator(".recurring-order-card")).toHaveCount(1);
        await expect(a.page.locator(".transaction-recurring-pill")).toHaveCount(
          0,
        );
        await triggerSchedulerPass(a.page);
        await a.page.waitForTimeout(5_000);
        await expect(dueDialog(a.page)).toBeHidden();
        await a.page.goto("/#wallet");
        expect(await readBalanceSat(a.page)).toBe(FUNDING_SAT);
        expect(await readBalanceSat(b.page)).toBe(0);
      } else {
        if (action === "countdown expires") {
          await expect
            .poll(async () => (await readOrder(a.page)).runCount, {
              timeout: 15_000,
              intervals: [200],
            })
            .toBe(1);
          expect(Date.now() - appearedAt).toBeGreaterThanOrEqual(8_000);
          expect(Date.now() - appearedAt).toBeLessThan(15_000);
        }
        await expectReceived(b.page);
        await expectPaidHistory(a.page, hash);
      }
    });
  });
}

test("insufficient funds warns once and retries after a top-up", async ({
  bootAccount,
}) => {
  const a = await bootAccount("A");
  const b = await bootAccount("B");
  await test.step("schedule from an empty wallet", async () => {
    await fundAndConnect(a, b, false);
    await openForm(a.page);
  });
  const hash = await saveOrder(a.page);
  const sendAt = await claimOrder(a.page);
  await test.step("due payment waits for funds without paying", async () => {
    await a.page.goto("/#wallet/transactions");
    await expect(
      a.page.locator(".recurring-order-card .recurring-underfunded-hint"),
    ).toHaveText("low balance");
    await waitUntil(sendAt);
    await triggerSchedulerPass(a.page);
    const toast = a.page.locator(".toast-container .toast", {
      hasText:
        "Not enough funds for a recurring payment right now. It will be retried.",
    });
    await expect(toast).toBeVisible();
    await expect(dueDialog(a.page)).toBeHidden();
    expect((await readOrder(a.page)).runCount).toBe(0);
    expect(await readBalanceSat(b.page)).toBe(0);
    await expect(toast).toBeHidden();
    await triggerSchedulerPass(a.page);
    await a.page.waitForTimeout(2_000);
    await expect(toast).toBeHidden();
  });
  await test.step("fund the wallet and let the scheduler retry", async () => {
    await topUp(a.page, FUNDING_SAT);
    await expect.poll(() => readBalanceSat(a.page)).toBe(FUNDING_SAT);
    await triggerSchedulerPass(a.page);
    await expect(dueDialog(a.page)).toBeVisible();
    await dueDialog(a.page)
      .getByRole("button", { name: "Pay", exact: true })
      .click();
    await expectReceived(b.page);
    await expectPaidHistory(a.page, hash);
  });
});

test("two devices sync the claim and pay only once in the background", async ({
  bootAccount,
}) => {
  const a = await bootAccount("A", { hidden: true });
  const b = await bootAccount("B");
  const a2 = await bootAccount("A2", { identity: a.identity, hidden: true });
  await test.step("fund and sync both payer devices", async () => {
    await fundAndConnect(a, b);
    await expect
      .poll(() => readBalanceSat(a2.page), { timeout: 60_000 })
      .toBe(FUNDING_SAT);
    await a2.page.goto("/#wallet/transactions");
    await openForm(a.page);
  });
  const hash = await saveOrder(a.page);
  await test.step("both devices list the payment and converge on one claim", async () => {
    await expect(a2.page.locator(".recurring-order-card")).toHaveCount(1);
    await Promise.all([
      triggerSchedulerPass(a.page),
      triggerSchedulerPass(a2.page),
    ]);
    await claimOrder(a.page);
    await expect
      .poll(async () => {
        const [first, second] = await Promise.all([
          readOrder(a.page),
          readOrder(a2.page),
        ]);
        return (
          first.claimDeviceId !== null &&
          first.claimDeviceId === second.claimDeviceId &&
          first.claimAtSec === second.claimAtSec
        );
      })
      .toBe(true);
  });
  await test.step("the winning device sends silently, once", async () => {
    const sendAt = await claimOrder(a.page);
    await waitUntil(sendAt);
    await Promise.all([
      triggerSchedulerPass(a.page),
      triggerSchedulerPass(a2.page),
    ]);
    const received = await expectReceived(b.page);
    await expect(dueDialog(a.page)).toBeHidden();
    await expect(dueDialog(a2.page)).toBeHidden();
    for (const device of [a, a2]) await expectPaidHistory(device.page, hash);
    await a.page.goto("/#wallet");
    await a2.page.goto("/#wallet");
    await expect
      .poll(
        async () => {
          const balance = await readBalanceSat(a.page);
          return (
            balance < FUNDING_SAT && balance === (await readBalanceSat(a2.page))
          );
        },
        { timeout: 60_000 },
      )
      .toBe(true);
    const balance = await readBalanceSat(a.page);
    expect(balance).toBeGreaterThanOrEqual(FUNDING_SAT - ORDER_SAT - 2);
    await Promise.all([
      triggerSchedulerPass(a.page),
      triggerSchedulerPass(a2.page),
    ]);
    await a.page.waitForTimeout(5_000);
    expect(await readBalanceSat(b.page)).toBe(received);
    expect(await readBalanceSat(a.page)).toBe(balance);
    expect(await readBalanceSat(a2.page)).toBe(balance);
    for (const device of [a, a2])
      expect((await readOrder(device.page)).runCount).toBe(1);
  });
});

test("pause suppresses a due run and resume advances it into the future", async ({
  bootAccount,
}) => {
  const a = await bootAccount("A");
  const b = await bootAccount("B");
  await fundAndConnect(a, b);
  await openForm(a.page);
  await saveOrder(a.page);
  const sendAt = await claimOrder(a.page);
  await test.step("pause a claimed payment before its due time", async () => {
    await a.page.getByRole("button", { name: "Pause", exact: true }).click();
    await expect(
      a.page.getByRole("button", { name: "Resume", exact: true }),
    ).toBeVisible();
    await waitUntil(sendAt + 1);
    await triggerSchedulerPass(a.page);
    await a.page.waitForTimeout(2_000);
    await expect(dueDialog(a.page)).toBeHidden();
    expect((await readOrder(a.page)).runCount).toBe(0);
    expect(await readBalanceSat(b.page)).toBe(0);
    await a.page.goto("/#wallet");
    expect(await readBalanceSat(a.page)).toBe(FUNDING_SAT);
  });
  await test.step("resume without paying the missed period", async () => {
    await a.page.goto("/#wallet/transactions");
    await expect(a.page.locator(".recurring-order-card")).toContainText(
      "paused",
    );
    await a.page.locator(".recurring-order-card").click();
    await a.page.getByRole("button", { name: "Resume", exact: true }).click();
    await expect(detailValue(a.page, "Next payment")).toBeVisible();
    expect((await readOrder(a.page)).nextDueAtSec).toBeGreaterThan(
      Date.now() / 1000,
    );
    await triggerSchedulerPass(a.page);
    await a.page.waitForTimeout(2_000);
    await expect(dueDialog(a.page)).toBeHidden();
    expect(await readBalanceSat(b.page)).toBe(0);
    expect((await readOrder(a.page)).runCount).toBe(0);
  });
});

test("editing amount and date clears an in-flight claim", async ({
  bootAccount,
}) => {
  const a = await bootAccount("A");
  const b = await bootAccount("B");
  await fundAndConnect(a, b);
  await openForm(a.page);
  const hash = await saveOrder(a.page);
  const sendAt = await claimOrder(a.page);
  const newDate = new Date(Date.now() + 3_600_000);
  await test.step("edit the claimed payment and verify its new values", async () => {
    await a.page.getByRole("button", { name: "Edit", exact: true }).click();
    await a.page
      .getByRole("button", { name: "Clear form", exact: true })
      .click();
    await enterAmount(a.page, 20);
    await a.page
      .getByLabel("Next payment", { exact: true })
      .fill(dateTimeLocal(newDate));
    await a.page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(a.page.locator(".recurring-detail-amount-value")).toHaveText(
      "20 sat",
    );
    await expect(detailValue(a.page, "Next payment")).toHaveText(
      new Intl.DateTimeFormat("en-US", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(newDate),
    );
    const nextMinute = Math.floor(newDate.getTime() / 60_000) * 60;
    await expect
      .poll(async () => (await readOrder(a.page)).nextDueAtSec)
      .toBe(nextMinute);
    expect((await readOrder(a.page)).claimDeviceId).toBeNull();
    await a.page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(
      a.page.getByLabel("Next payment", { exact: true }),
    ).toHaveValue(dateTimeLocal(newDate));
    await a.page.goto(`/${hash}`);
  });
  await test.step("the old claim's send time passes without sending the old amount", async () => {
    await waitUntil(sendAt + 1);
    await triggerSchedulerPass(a.page);
    await a.page.waitForTimeout(2_000);
    await expect(dueDialog(a.page)).toBeHidden();
    expect((await readOrder(a.page)).runCount).toBe(0);
    expect(await readBalanceSat(b.page)).toBe(0);
    await a.page.goto("/#wallet");
    expect(await readBalanceSat(a.page)).toBe(FUNDING_SAT);
  });
  await test.step("paying the edited order sends the new amount", async () => {
    await a.page.goto(`/${hash}`);
    await a.page.getByRole("button", { name: "Pay", exact: true }).click();
    await expectReceived(b.page, 20);
    await expectPaidHistory(a.page, hash);
  });
});

test("delete requires two taps and removes the scheduled card", async ({
  bootAccount,
}) => {
  const a = await bootAccount("A");
  const b = await bootAccount("B");
  await fundAndConnect(a, b, false);
  await openForm(a.page);
  const hash = await saveOrder(
    a.page,
    ORDER_SAT,
    new Date(Date.now() + 3_600_000),
  );
  await test.step("first tap only arms deletion", async () => {
    await a.page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(
      a.page.getByRole("button", {
        name: "Click once more to delete.",
        exact: true,
      }),
    ).toBeVisible();
    expect(new URL(a.page.url()).hash).toBe(hash);
    expect((await readOrder(a.page)).amount).toBe(ORDER_SAT);
  });
  await test.step("second tap deletes and returns to history", async () => {
    await a.page
      .getByRole("button", { name: "Click once more to delete.", exact: true })
      .click();
    await expect(a.page).toHaveURL(/#wallet\/transactions$/);
    await expect(a.page.locator(".recurring-order-card")).toHaveCount(0);
    await a.page.goto("/#wallet");
    await a.page.goto("/#wallet/transactions");
    await expect(a.page.locator(".recurring-order-card")).toHaveCount(0);
  });
});

test("form rejects an empty amount and a first payment in the past", async ({
  bootAccount,
}) => {
  const a = await bootAccount("A");
  const b = await bootAccount("B");
  await fundAndConnect(a, b, false);
  await openForm(a.page);
  const submit = a.page.getByRole("button", {
    name: "Set up recurring payment",
    exact: true,
  });
  await test.step("empty amount cannot be submitted", async () => {
    await expect(submit).toBeDisabled();
    await enterAmount(a.page, ORDER_SAT);
    await expect(submit).toBeEnabled();
  });
  await test.step("a past first payment shows validation and cannot be saved", async () => {
    const input = a.page.getByLabel("First payment", { exact: true });
    const past = dateTimeLocal(new Date(Date.now() - 120_000));
    expect(await input.getAttribute("min")).toBeTruthy();
    await input.fill(past);
    await expect(
      a.page.getByText("The first payment cannot be in the past.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(submit).toBeDisabled();
    await a.page.goto("/#wallet/transactions");
    await expect(a.page.locator(".recurring-order-card")).toHaveCount(0);
  });
});

test("fiat recurring amount converts, shows approximate sats and pays", async ({
  bootAccount,
}) => {
  const a = await bootAccount("A", { fiat: true });
  const b = await bootAccount("B");
  await fundAndConnect(a, b);
  await test.step("switch the keypad to CZK and save one koruna", async () => {
    await openForm(a.page);
    await a.page.getByTitle("Switch unit", { exact: true }).click();
    await expect(a.page.locator(".amount-unit")).toHaveText("CZK");
  });
  const hash = await saveOrder(a.page, 1, new Date(Date.now() + 3_600_000));
  await test.step("verify the fixed fiat amount and its sat side", async () => {
    expect(await readOrder(a.page)).toMatchObject({
      amount: 100,
      unit: "czk",
    });
    await expect(
      a.page.locator(".recurring-detail-amount-secondary"),
    ).toHaveText(`~${FIXTURE_AMOUNT_SAT} sat`);
    await a.page.goto("/#wallet/transactions");
    const card = a.page.locator(".recurring-order-card");
    await expect(card).toContainText("1 CZK");
    await expect(card).toContainText(`~${FIXTURE_AMOUNT_SAT} sat`);
  });
  await test.step("pay the fiat amount at the fixture's 40 sat per CZK rate", async () => {
    await a.page.locator(".recurring-order-card").click();
    await a.page.getByRole("button", { name: "Pay", exact: true }).click();
    await expectReceived(b.page, FIXTURE_AMOUNT_SAT);
    await expectPaidHistory(a.page, hash);
    await a.page.getByRole("button", { name: "Edit", exact: true }).click();
    await a.page.getByTitle("Switch unit", { exact: true }).click();
    await a.page.goto("/#wallet");
    await expect
      .poll(() => readBalanceSat(a.page))
      .toBeLessThanOrEqual(FUNDING_SAT - FIXTURE_AMOUNT_SAT);
    expect(await readBalanceSat(a.page)).toBeGreaterThanOrEqual(
      FUNDING_SAT - FIXTURE_AMOUNT_SAT - 2,
    );
  });
});

test("repeat regularly prefills the contact and amount from a completed payment", async ({
  bootAccount,
}) => {
  const a = await bootAccount("A");
  const b = await bootAccount("B");
  const contactId = await fundAndConnect(a, b);
  await test.step("make a plain contact payment", async () => {
    await a.page.goto(`/#contact/${contactId}/pay`);
    await enterAmount(a.page, ORDER_SAT);
    await a.page.getByRole("button", { name: "Pay", exact: true }).click();
    await expectReceived(b.page);
  });
  await test.step("expand the outgoing history row and repeat it", async () => {
    await a.page.goto("/#wallet/transactions");
    const outgoing = a.page
      .locator(".transaction-card")
      .filter({ has: a.page.locator(".transaction-amount.is-negative") });
    await expect(outgoing).toHaveCount(1);
    await outgoing.click();
    await outgoing
      .getByRole("button", { name: "Repeat regularly", exact: true })
      .click();
    await expect(a.page).toHaveURL(/#wallet\/recurring\/new\?/);
    const params = new URLSearchParams(
      new URL(a.page.url()).hash.split("?")[1],
    );
    expect(params.get("contact")).toBe(contactId);
    expect(params.get("amount")).toBe(String(ORDER_SAT));
    await expect(
      a.page.locator(".recurring-recipient-header h3"),
    ).not.toBeEmpty();
    await expect(
      a.page.getByRole("button", { name: "Change recipient", exact: true }),
    ).toBeVisible();
    await expect(a.page.locator(".amount-number")).toHaveText(
      String(ORDER_SAT),
    );
    await expect(a.page.locator(".amount-unit")).toHaveText("sat");
    await expect(
      a.page.getByRole("button", {
        name: "Set up recurring payment",
        exact: true,
      }),
    ).toBeEnabled();
  });
});
