import { expect } from "@playwright/test";
import { readBalanceSat, relaunchApp } from "./helpers/appState";
import { FIXTURE_AMOUNT_SAT } from "./helpers/network";
import {
  addLightningContact,
  dateTimeLocal,
  detailValue,
  dueDialog,
  enterAmount,
  expectPaidHistory,
  expectReceived,
  FUNDING_SAT,
  fundAndConnect,
  invoicePaid,
  makeDue,
  MAX_FEE_SAT,
  MINT_HOST,
  nowSec,
  openForm,
  ORDER_SAT,
  readOrder,
  saveOrder,
  serveLightningAddress,
  showCountdown,
  test,
  triggerSchedulerPass,
  waitUntil,
} from "./helpers/recurringPayments";
import { topUp } from "./helpers/wallet";

test.describe.configure({ mode: "parallel" });
test.use({ actionTimeout: 20_000 });

const DAY_SEC = 24 * 3600;

test("the countdown's Cancel skips a period and its Pay consumes the next, linked from history", async ({
  bootAccount,
}) => {
  const a = await bootAccount("A");
  const b = await bootAccount("B");
  await test.step("fund A and save both contacts", () => fundAndConnect(a, b));
  const hash =
    await test.step("create a daily payment bound to the default mint", async () => {
      await openForm(a.page);
      return saveOrder(a.page);
    });
  await expect(detailValue(a.page, "Paid from")).toHaveText(MINT_HOST);
  expect((await readOrder(a.page)).rail).toBe("cashu");
  await test.step("Cancel this payment skips the period without paying", async () => {
    await showCountdown(a.page);
    const due = (await readOrder(a.page)).nextDueAtSec;
    await dueDialog(a.page)
      .getByRole("button", { name: "Cancel this payment", exact: true })
      .click();
    await expect(dueDialog(a.page)).toBeHidden();
    await expect(detailValue(a.page, "Last payment")).toContainText("skipped");
    expect(await readOrder(a.page)).toMatchObject({ runCount: 0 });
    expect((await readOrder(a.page)).nextDueAtSec).toBeGreaterThan(due);
    await a.page.goto("/#wallet/transactions");
    await expect(a.page.getByTestId("recurring-order-card")).toHaveCount(1);
    await expect(a.page.getByTestId("transaction-recurring-pill")).toHaveCount(
      0,
    );
    await a.page.goto("/#wallet");
    expect(await readBalanceSat(a.page)).toBe(FUNDING_SAT);
    expect(await readBalanceSat(b.page)).toBe(0);
  });
  await test.step("the next countdown's Pay sends the sats after mint fees", async () => {
    await showCountdown(a.page);
    await dueDialog(a.page)
      .getByRole("button", { name: "Pay", exact: true })
      .click();
    await expect(
      a.page.getByRole("status").filter({ hasText: /Sent\s*10\s*sat/ }),
    ).toBeVisible({ timeout: 60_000 });
    await expectReceived(b.page);
    await expectPaidHistory(a.page, hash);
  });
  await test.step("the paid run moves the schedule to the next day", async () => {
    const order = await readOrder(a.page);
    expect(order.runCount).toBe(1);
    expect(order.nextDueAtSec).toBeGreaterThan(nowSec() + DAY_SEC / 2);
    await a.page.goto("/#wallet");
    const balance = await readBalanceSat(a.page);
    expect(balance).toBeLessThanOrEqual(FUNDING_SAT - ORDER_SAT);
    expect(balance).toBeGreaterThanOrEqual(
      FUNDING_SAT - ORDER_SAT - MAX_FEE_SAT,
    );
  });
});

test("an expired countdown pays and its note reaches the contact and both histories", async ({
  bootAccount,
}) => {
  const note = "Rent for October";
  const a = await bootAccount("A");
  const b = await bootAccount("B");
  await test.step("create a Cashu payment with a note", async () => {
    await fundAndConnect(a, b);
    await openForm(a.page);
    await a.page.getByRole("textbox", { name: "Note", exact: true }).fill(note);
  });
  const hash = await saveOrder(a.page);
  await expect(detailValue(a.page, "Note")).toHaveText(note);
  await test.step("let the countdown run out", async () => {
    await showCountdown(a.page);
    const appearedAt = Date.now();
    await expect
      .poll(async () => (await readOrder(a.page)).runCount, {
        timeout: 15_000,
        intervals: [200],
      })
      .toBe(1);
    expect(Date.now() - appearedAt).toBeGreaterThanOrEqual(8_000);
    expect(Date.now() - appearedAt).toBeLessThan(15_000);
    await expectReceived(b.page);
    await expectPaidHistory(a.page, hash);
  });
  await test.step("the payer's history row shows the note", async () => {
    await a.page.goto("/#wallet/transactions");
    await expect(a.page.getByTestId("recurring-order-note")).toHaveText(note);
    await expect(
      a.page
        .getByTestId("transaction-card")
        .filter({ has: a.page.getByTestId("transaction-recurring-pill") }),
    ).toContainText(note);
  });
  await test.step("the contact's received payment shows the note", async () => {
    await b.page.goto("/#wallet/transactions");
    await expect(
      b.page.getByTestId("transaction-card").filter({ hasText: note }),
    ).toHaveCount(1);
  });
});

test("an overdue payment goes out right after the app launches", async ({
  bootAccount,
}) => {
  const a = await bootAccount("A", { hidden: true });
  const b = await bootAccount("B");
  await test.step("fund A and create a payment", async () => {
    await fundAndConnect(a, b);
    await openForm(a.page);
  });
  const hash = await saveOrder(a.page);
  // Due a few seconds out, so no pass of the open app pays it before it closes.
  const due = await makeDue(a.page, nowSec() + 5);
  await test.step("keep the app closed past the due time", () =>
    relaunchApp(a.page, "/#wallet", async () => {
      expect(nowSec()).toBeLessThan(due);
      await waitUntil(due + 2);
    }));
  await test.step("the launched app pays it without waiting", async () => {
    await expect
      .poll(async () => (await readOrder(a.page)).runCount, {
        timeout: 15_000,
      })
      .toBe(1);
    await expectReceived(b.page);
    await expectPaidHistory(a.page, hash);
  });
});

test("a run paid from the countdown and a background device at once goes out once", async ({
  bootAccount,
}) => {
  const a = await bootAccount("A");
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
  await expect(a2.page.getByTestId("recurring-order-card")).toHaveCount(1);
  await test.step("A presses Pay while the hidden A2 runs its own pass", async () => {
    await showCountdown(a.page);
    const due = (await readOrder(a.page)).nextDueAtSec;
    await expect
      .poll(async () => (await readOrder(a2.page)).nextDueAtSec, {
        timeout: 60_000,
        intervals: [100],
      })
      .toBe(due);
    await Promise.all([
      dueDialog(a.page)
        .getByRole("button", { name: "Pay", exact: true })
        .click(),
      triggerSchedulerPass(a2.page),
    ]);
  });
  await test.step("the contact receives one payment and both devices agree", async () => {
    const received = await expectReceived(b.page);
    for (const device of [a, a2]) {
      await expect
        .poll(async () => (await readOrder(device.page)).runCount, {
          timeout: 60_000,
        })
        .toBe(1);
    }
    await expect(dueDialog(a.page)).toBeHidden();
    for (const device of [a, a2]) await expectPaidHistory(device.page, hash);
    await a.page.goto("/#wallet");
    await a2.page.goto("/#wallet");
    await expect
      .poll(
        async () => {
          const balance = await readBalanceSat(a.page);
          return balance === (await readBalanceSat(a2.page)) ? balance : null;
        },
        { timeout: 60_000 },
      )
      .toBeGreaterThanOrEqual(FUNDING_SAT - ORDER_SAT - MAX_FEE_SAT);
    expect(await readBalanceSat(b.page)).toBe(received);
  });
});

test("a contact with only a Lightning address is paid by melting the envelope", async ({
  bootAccount,
  request,
}) => {
  const a = await bootAccount("A");
  const quoteIds = await serveLightningAddress(a.page, request);
  await test.step("fund A and save a Lightning-only contact", async () => {
    await topUp(a.page, FUNDING_SAT);
    await expect.poll(() => readBalanceSat(a.page)).toBe(FUNDING_SAT);
    await addLightningContact(a.page);
    await openForm(a.page);
  });
  const hash = await saveOrder(a.page);
  expect((await readOrder(a.page)).rail).toBe("lightning");
  await test.step("the countdown's Pay pays the contact's invoice once", async () => {
    await showCountdown(a.page);
    await dueDialog(a.page)
      .getByRole("button", { name: "Pay", exact: true })
      .click();
    await expect(
      a.page
        .getByRole("status")
        .filter({ hasText: new RegExp(`Sent\\s*${ORDER_SAT}\\s*sat`) }),
    ).toBeVisible({ timeout: 60_000 });
    expect(quoteIds).toHaveLength(1);
    expect(await invoicePaid(request, quoteIds[0] ?? "")).toBe(true);
    await expectPaidHistory(a.page, hash);
  });
  await test.step("the paid run moves on and nothing more is paid", async () => {
    const order = await readOrder(a.page);
    expect(order.runCount).toBe(1);
    expect(order.nextDueAtSec).toBeGreaterThan(nowSec() + DAY_SEC / 2);
    await a.page.goto("/#wallet");
    const balance = await readBalanceSat(a.page);
    // Paid once: the swap into the envelope and the melt each cost fees.
    expect(balance).toBeLessThanOrEqual(FUNDING_SAT - ORDER_SAT);
    expect(balance).toBeGreaterThan(FUNDING_SAT - 2 * ORDER_SAT);
    expect(quoteIds).toHaveLength(1);
  });
  await test.step("two taps on Delete remove the payment", async () => {
    await a.page.goto(`/${hash}`);
    await a.page.getByRole("button", { name: "Delete", exact: true }).click();
    await a.page
      .getByRole("button", { name: "Click once more to delete.", exact: true })
      .click();
    await expect(a.page).toHaveURL(/#wallet\/transactions$/);
    await expect(a.page.getByTestId("recurring-order-card")).toHaveCount(0);
  });
});

test("editing amount and date saves the new values into the payment", async ({
  bootAccount,
}) => {
  const a = await bootAccount("A");
  const b = await bootAccount("B");
  await fundAndConnect(a, b, false);
  await openForm(a.page);
  await saveOrder(a.page);
  const newDate = new Date(Date.now() + 3_600_000);
  await a.page.getByRole("button", { name: "Edit", exact: true }).click();
  await a.page.getByRole("button", { name: "Clear form", exact: true }).click();
  await enterAmount(a.page, 20);
  await a.page
    .getByLabel("Next payment", { exact: true })
    .fill(dateTimeLocal(newDate));
  await a.page
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(a.page.getByTestId("recurring-detail-amount")).toHaveText(
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
  await expect
    .poll(async () => (await readOrder(a.page)).nextDueAtSec)
    .toBe(Math.floor(newDate.getTime() / 60_000) * 60);
  await a.page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(a.page).toHaveURL(/\/edit$/);
  await expect(
    a.page.getByRole("textbox", { name: "Next payment", exact: true }),
  ).toHaveValue(dateTimeLocal(newDate));
});

test("a fiat recurring amount stays fixed in CZK and shows approximate sats", async ({
  bootAccount,
}) => {
  const a = await bootAccount("A", { fiat: true });
  const b = await bootAccount("B");
  await fundAndConnect(a, b, false);
  await test.step("switch the keypad to CZK and save one koruna", async () => {
    await openForm(a.page);
    await a.page.getByTitle("Switch unit", { exact: true }).click();
    await expect(a.page.getByTestId("amount-display")).toContainText("CZK");
  });
  await saveOrder(a.page, 1);
  await test.step("verify the fixed fiat amount and its sat side", async () => {
    expect(await readOrder(a.page)).toMatchObject({
      amount: 100,
      unit: "czk",
    });
    await expect(
      a.page.getByTestId("recurring-detail-amount-secondary"),
    ).toHaveText(`~${FIXTURE_AMOUNT_SAT} sat`);
    await a.page.goto("/#wallet/transactions");
    const card = a.page.getByTestId("recurring-order-card");
    await expect(card).toContainText("1 CZK");
    await expect(card).toContainText(`~${FIXTURE_AMOUNT_SAT} sat`);
  });
});
