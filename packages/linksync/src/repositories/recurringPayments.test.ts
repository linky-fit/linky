import { NonEmptyString100, PositiveInt } from "@evolu/common";
import { describe, expect, it } from "vitest";
import { createId } from "../model/ids";
import { linkyStore, runNow } from "../testing/linky";
import {
  makeRecurringPaymentsRepository,
  normalizeRecurringPayment,
} from "./recurringPayments";
import { makeTransactionsRepository } from "./transactions";

const text = (value: string) => NonEmptyString100.orThrow(value);
const int = (value: number) => PositiveInt.orThrow(value);

const payment = () => ({
  id: createId<"RecurringPayment">(),
  createdAtSec: int(100),
  contactId: createId<"Contact">(),
  amount: int(2100),
  unit: text("sat"),
  intervalUnit: text("month"),
  intervalCount: int(1),
  anchorAtSec: int(1_000),
  nextDueAtSec: int(1_000),
});

describe("recurring payments repository", () => {
  it("returns records whose schedule columns are complete", () => {
    const { store } = linkyStore();
    const payments = makeRecurringPaymentsRepository(store);
    const complete = payment();
    runNow(payments.insert(complete));
    expect(runNow(payments.all)).toMatchObject([
      { id: complete.id, amount: 2100, unit: "sat", intervalUnit: "month" },
    ]);
  });

  it("skips a row whose schedule is still arriving column by column", () => {
    const { store } = linkyStore();
    const payments = makeRecurringPaymentsRepository(store);
    const row = payment();
    runNow(payments.insert(row));
    const [stored] = runNow(store.rows("transactions", "recurringPayment"));
    expect(stored).toBeDefined();
    if (!stored) return;
    expect(normalizeRecurringPayment(stored)).not.toBeNull();
    expect(
      normalizeRecurringPayment({ ...stored, intervalUnit: null }),
    ).toBeNull();
    expect(normalizeRecurringPayment({ ...stored, unit: null })).toBeNull();
  });

  it("patches the schedule in place and counts toward the transactions scope", () => {
    const { store } = linkyStore();
    const payments = makeRecurringPaymentsRepository(store);
    const transactions = makeTransactionsRepository(store);
    const row = payment();
    runNow(payments.insert(row));
    runNow(
      payments.update(row.id, {
        nextDueAtSec: int(3_000),
        lastRunStatus: text("paid"),
        runCount: PositiveInt.orThrow(1),
      }),
    );
    expect(runNow(payments.byId(row.id))).toMatchObject({
      nextDueAtSec: 3_000,
      lastRunStatus: "paid",
      runCount: 1,
    });
    expect(runNow(transactions.all)).toEqual([]);
    expect(runNow(store.activeIndex("transactions"))).toBe(0);
  });

  it("removes a payment without touching the history", () => {
    const { store } = linkyStore();
    const payments = makeRecurringPaymentsRepository(store);
    const row = payment();
    runNow(payments.insert(row));
    runNow(payments.remove(row.id));
    expect(runNow(payments.all)).toEqual([]);
  });
});
