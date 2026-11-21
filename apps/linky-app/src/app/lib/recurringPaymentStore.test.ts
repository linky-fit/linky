import type { RecurringPaymentRecord } from "@linky-fit/linksync";
import { describe, expect, it } from "vitest";
import { makeTestLinkyStore } from "../../testUtils/linkyStore";
import {
  contactIdFor,
  recurringPaymentIdFor,
} from "../../testUtils/recurringOrders";
import {
  readRecurringPaymentOrder,
  recurringProgressColumn,
} from "@linky-fit/recurring-payment";
import { recurringPaymentColumns } from "./recurringPaymentStore";

const { appOwner } = makeTestLinkyStore();

const record = (
  overrides: Partial<RecurringPaymentRecord> = {},
): RecurringPaymentRecord => ({
  id: recurringPaymentIdFor("rp-1"),
  ownerId: appOwner.id,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  createdAtSec: 1_700_000_000,
  contactId: contactIdFor("contact-1"),
  mintUrl: "https://mint.example",
  rail: "cashu",
  amount: 21_000,
  unit: "sat",
  note: null,
  intervalUnit: "month",
  intervalCount: 1,
  anchorAtSec: 1_700_000_000,
  timeZone: "Europe/Prague",
  progress: recurringProgressColumn({
    runCount: 0,
    nextDueAtSec: 1_702_592_400,
  }),
  lastRunAtSec: null,
  lastRunStatus: null,
  pausedAtSec: null,
  ...overrides,
});

describe("readRecurringPaymentOrder", () => {
  it("reads a payment with its mint, rail and no run yet", () => {
    expect(readRecurringPaymentOrder(record())).toEqual({
      id: recurringPaymentIdFor("rp-1"),
      createdAtSec: 1_700_000_000,
      contactId: contactIdFor("contact-1"),
      mintUrl: "https://mint.example",
      rail: "cashu",
      amount: { amount: 21_000, unit: "sat" },
      note: null,
      schedule: {
        anchorAtSec: 1_700_000_000,
        interval: { unit: "month", count: 1 },
        timeZone: "Europe/Prague",
        nextDueAtSec: 1_702_592_400,
        runCount: 0,
        pausedAtSec: null,
      },
      lastRunAtSec: null,
      lastRunStatus: null,
    });
  });

  it("keeps a fiat amount in its own unit", () => {
    const order = readRecurringPaymentOrder(
      record({ amount: 15_050, unit: "czk" }),
    );
    expect(order?.amount).toEqual({ amount: 15_050, unit: "czk" });
  });

  it("reads the run count and a known run status", () => {
    const order = readRecurringPaymentOrder(
      record({
        lastRunStatus: "paid",
        progress: recurringProgressColumn({
          runCount: 3,
          nextDueAtSec: 1_702_592_400,
        }),
      }),
    );
    expect(order?.lastRunStatus).toBe("paid");
    expect(order?.schedule.runCount).toBe(3);
  });

  it("ignores an unknown run status", () => {
    const order = readRecurringPaymentOrder(
      record({
        lastRunStatus: "teleported",
      }),
    );
    expect(order?.lastRunStatus).toBeNull();
  });

  it.each([
    ["unknown rail", { rail: "carrier pigeon" }],
    ["unreadable progress", { progress: "{}" }],
    ["unknown interval unit", { intervalUnit: "fortnight" }],
    ["unknown amount unit", { unit: "gold" }],
  ])("rejects a record with %s", (_label, overrides) => {
    expect(readRecurringPaymentOrder(record(overrides))).toBeNull();
  });
});

describe("recurringPaymentColumns", () => {
  const input = {
    amount: { amount: 21, unit: "sat" as const },
    contactId: contactIdFor("contact-1"),
    firstDueAtSec: 1_702_592_400,
    interval: { unit: "month" as const, count: 1 },
  };

  it("writes the note and omits a missing one", () => {
    const contactId = contactIdFor("contact-1");
    expect(
      recurringPaymentColumns({ ...input, note: "Rent" }, contactId).note,
    ).toBe("Rent");
    expect(
      recurringPaymentColumns({ ...input, note: null }, contactId),
    ).not.toHaveProperty("note");
  });
});
