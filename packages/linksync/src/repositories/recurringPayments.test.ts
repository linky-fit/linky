import {
  NonEmptyString100,
  NonEmptyString1000,
  PositiveInt,
} from "@evolu/common";
import { describe, expect, it } from "vitest";
import { createId } from "@linky-fit/domain";
import { linkyStore, runNow } from "../testing/linky";
import { makeContactsRepository } from "./contacts";
import {
  makeRecurringPaymentsRepository,
  normalizeRecurringPayment,
} from "./recurringPayments";

const text = (value: string) => NonEmptyString100.orThrow(value);
const int = (value: number) => PositiveInt.orThrow(value);
const progress = (runCount: number, nextDueAtSec: number) =>
  NonEmptyString1000.orThrow(JSON.stringify({ runCount, nextDueAtSec }));

const payment = () => ({
  id: createId<"RecurringPayment">(),
  createdAtSec: int(100),
  contactId: createId<"Contact">(),
  mintUrl: NonEmptyString1000.orThrow("https://mint.example"),
  rail: text("cashu"),
  amount: int(2100),
  unit: text("sat"),
  intervalUnit: text("month"),
  intervalCount: int(1),
  anchorAtSec: int(1_000),
  progress: progress(0, 1_000),
});

describe("recurring payments repository", () => {
  it("returns records whose schedule columns are complete", () => {
    const { store } = linkyStore();
    const payments = makeRecurringPaymentsRepository(store);
    const complete = payment();
    runNow(payments.insert(complete));
    expect(runNow(payments.all)).toMatchObject([
      {
        id: complete.id,
        amount: 2100,
        unit: "sat",
        intervalUnit: "month",
        mintUrl: "https://mint.example",
        rail: "cashu",
        progress: complete.progress,
      },
    ]);
  });

  it("skips a row whose schedule is still arriving column by column", () => {
    const { store } = linkyStore();
    const payments = makeRecurringPaymentsRepository(store);
    const row = payment();
    runNow(payments.insert(row));
    const [stored] = runNow(store.rows("contacts", "recurringPayment"));
    expect(stored).toBeDefined();
    if (!stored) return;
    expect(normalizeRecurringPayment(stored)).not.toBeNull();
    for (const column of [
      "intervalUnit",
      "unit",
      "mintUrl",
      "rail",
      "progress",
    ] as const) {
      expect(
        normalizeRecurringPayment({ ...stored, [column]: null }),
      ).toBeNull();
    }
  });

  it("patches the progress in place without adding a contact", () => {
    const { store } = linkyStore();
    const payments = makeRecurringPaymentsRepository(store);
    const contacts = makeContactsRepository(store);
    const row = payment();
    runNow(payments.insert(row));
    runNow(
      payments.update(row.id, {
        progress: progress(1, 3_000),
        lastRunStatus: text("paid"),
      }),
    );
    expect(runNow(payments.byId(row.id))).toMatchObject({
      progress: progress(1, 3_000),
      lastRunStatus: "paid",
    });
    expect(runNow(contacts.all)).toEqual([]);
  });

  it("removes a payment", () => {
    const { store } = linkyStore();
    const payments = makeRecurringPaymentsRepository(store);
    const row = payment();
    runNow(payments.insert(row));
    runNow(payments.remove(row.id));
    expect(runNow(payments.all)).toEqual([]);
  });

  it("lists a removed payment with its last mint, rail and progress", () => {
    const { store } = linkyStore();
    const payments = makeRecurringPaymentsRepository(store);
    const removed = payment();
    const kept = payment();
    runNow(payments.insert(removed));
    runNow(payments.insert(kept));
    runNow(payments.update(removed.id, { progress: progress(4, 5_000) }));
    runNow(payments.remove(removed.id));
    expect(runNow(payments.deleted)).toMatchObject([
      {
        id: removed.id,
        mintUrl: "https://mint.example",
        rail: "cashu",
        progress: progress(4, 5_000),
      },
    ]);
  });

  it("keeps listing a removed payment after rotations and a forget", () => {
    const { store } = linkyStore();
    const payments = makeRecurringPaymentsRepository(store);
    const removed = payment();
    runNow(payments.insert(removed));
    runNow(payments.remove(removed.id));
    for (let rotation = 0; rotation < 5; rotation++) {
      runNow(store.rotate("contacts"));
      runNow(store.rotate("transactions"));
    }
    runNow(store.forget());
    expect(runNow(payments.deleted)).toMatchObject([{ id: removed.id }]);
  });

  it("does not list a payment whose old-shard copy was tombstoned by a move", () => {
    const { store } = linkyStore();
    const payments = makeRecurringPaymentsRepository(store);
    const row = payment();
    runNow(payments.insert(row));
    runNow(store.rotate("contacts"));
    runNow(payments.update(row.id, { progress: progress(1, 3_000) }));
    expect(runNow(payments.all)).toMatchObject([
      { id: row.id, progress: progress(1, 3_000) },
    ]);
    expect(runNow(payments.deleted)).toEqual([]);
  });
});
