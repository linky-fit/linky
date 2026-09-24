import type { RecurringPaymentRecord } from "@linky/linksync";
import {
  NonEmptyString100,
  NonNegativeInt,
  PositiveInt,
} from "@linky/linksync";
import { describe, expect, it } from "vitest";
import { makeTestLinkyStore } from "../../testUtils/linkyStore";
import {
  contactIdFor,
  recurringPaymentIdFor,
} from "../../testUtils/recurringOrders";
import { readRecurringPaymentOrder } from "@linky/recurring-payment";

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
  amount: PositiveInt.orThrow(21_000),
  unit: "sat",
  intervalUnit: "month",
  intervalCount: PositiveInt.orThrow(1),
  anchorAtSec: PositiveInt.orThrow(1_700_000_000),
  timeZone: NonEmptyString100.orThrow("Europe/Prague"),
  nextDueAtSec: PositiveInt.orThrow(1_702_592_400),
  lastRunAtSec: null,
  lastRunStatus: null,
  runCount: null,
  pausedAtSec: null,
  claimDeviceId: null,
  claimAtSec: null,
  claimDueAtSec: null,
  ...overrides,
});

describe("readRecurringPaymentOrder", () => {
  it("reads a payment with defaults filled in", () => {
    expect(readRecurringPaymentOrder(record())).toEqual({
      id: recurringPaymentIdFor("rp-1"),
      createdAtSec: 1_700_000_000,
      contactId: contactIdFor("contact-1"),
      amount: { amount: 21_000, unit: "sat" },
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
        runCount: NonNegativeInt.orThrow(3),
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
    ["unknown interval unit", { intervalUnit: "fortnight" }],
    ["unknown amount unit", { unit: "gold" }],
  ])("rejects a record with %s", (_label, overrides) => {
    expect(readRecurringPaymentOrder(record(overrides))).toBeNull();
  });
});
