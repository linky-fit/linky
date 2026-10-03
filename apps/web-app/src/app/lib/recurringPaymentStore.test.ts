import type { RecurringPaymentRecord } from "@linky-fit/linksync";
import { NonEmptyString100, PositiveInt } from "@linky-fit/linksync";
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
  isDeleted: null,
  createdAtSec: PositiveInt.orThrow(1_700_000_000),
  contactId: contactIdFor("contact-1"),
  mintUrl: "https://mint.example",
  rail: "cashu",
  amount: PositiveInt.orThrow(21_000),
  unit: "sat",
  note: null,
  intervalUnit: "month",
  intervalCount: PositiveInt.orThrow(1),
  anchorAtSec: PositiveInt.orThrow(1_700_000_000),
  timeZone: NonEmptyString100.orThrow("Europe/Prague"),
  progress: recurringProgressColumn({
    runCount: 0,
    nextDueAtSec: 1_702_592_400,
  }),
  lastRunAtSec: null,
  lastRunStatus: null,
  pausedAtSec: null,
  claimDeviceId: null,
  claimAtSec: null,
  claimDueAtSec: null,
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
      claim: null,
    });
  });

  it("keeps a fiat amount in its own unit", () => {
    const order = readRecurringPaymentOrder(
      record({ amount: PositiveInt.orThrow(15_050), unit: "czk" }),
    );
    expect(order?.amount).toEqual({ amount: 15_050, unit: "czk" });
  });

  it("reads a complete claim, the run count and a known run status", () => {
    const order = readRecurringPaymentOrder(
      record({
        claimDeviceId: NonEmptyString100.orThrow("device-a"),
        claimAtSec: PositiveInt.orThrow(1_702_592_100),
        claimDueAtSec: PositiveInt.orThrow(1_702_592_400),
        lastRunStatus: NonEmptyString100.orThrow("paid"),
        progress: recurringProgressColumn({
          runCount: 3,
          nextDueAtSec: 1_702_592_400,
        }),
      }),
    );
    expect(order?.claim).toEqual({
      deviceId: "device-a",
      atSec: 1_702_592_100,
      dueAtSec: 1_702_592_400,
    });
    expect(order?.lastRunStatus).toBe("paid");
    expect(order?.schedule.runCount).toBe(3);
  });

  it("ignores a partial claim and an unknown run status", () => {
    const order = readRecurringPaymentOrder(
      record({
        claimDeviceId: NonEmptyString100.orThrow("device-a"),
        lastRunStatus: NonEmptyString100.orThrow("teleported"),
      }),
    );
    expect(order?.claim).toBeNull();
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
