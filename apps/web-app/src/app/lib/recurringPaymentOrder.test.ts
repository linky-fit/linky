import { describe, expect, it } from "vitest";
import { readRecurringPaymentOrder } from "./recurringPaymentOrder";

const row = (overrides: Record<string, unknown> = {}) => ({
  id: "rp-1",
  ownerId: "owner-1",
  createdAtSec: 1_700_000_000,
  contactId: "contact-1",
  amountSat: 21_000,
  intervalUnit: "month",
  intervalCount: 1,
  anchorAtSec: 1_700_000_000,
  timeZone: "Europe/Prague",
  nextDueAtSec: 1_702_592_400,
  lastRunAtSec: null,
  lastRunStatus: null,
  runCount: null,
  maxRuns: null,
  endAtSec: null,
  pausedAtSec: null,
  claimDeviceId: null,
  claimAtSec: null,
  claimDueAtSec: null,
  ...overrides,
});

describe("readRecurringPaymentOrder", () => {
  it("reads a payment with defaults filled in", () => {
    expect(readRecurringPaymentOrder(row())).toEqual({
      id: "rp-1",
      ownerId: "owner-1",
      createdAtSec: 1_700_000_000,
      contactId: "contact-1",
      amountSat: 21_000,
      schedule: {
        anchorAtSec: 1_700_000_000,
        interval: { unit: "month", count: 1 },
        timeZone: "Europe/Prague",
        nextDueAtSec: 1_702_592_400,
        runCount: 0,
        maxRuns: null,
        endAtSec: null,
        pausedAtSec: null,
      },
      lastRunAtSec: null,
      lastRunStatus: null,
      claim: null,
    });
  });

  it("reads a complete claim and a known run status", () => {
    const order = readRecurringPaymentOrder(
      row({
        claimDeviceId: "device-a",
        claimAtSec: 1_702_592_100,
        claimDueAtSec: 1_702_592_400,
        lastRunStatus: "paid",
      }),
    );
    expect(order?.claim).toEqual({
      deviceId: "device-a",
      atSec: 1_702_592_100,
      dueAtSec: 1_702_592_400,
    });
    expect(order?.lastRunStatus).toBe("paid");
  });

  it("ignores a partial claim and an unknown run status", () => {
    const order = readRecurringPaymentOrder(
      row({ claimDeviceId: "device-a", lastRunStatus: "teleported" }),
    );
    expect(order?.claim).toBeNull();
    expect(order?.lastRunStatus).toBeNull();
  });

  it.each([
    ["unknown interval unit", { intervalUnit: "fortnight" }],
    ["missing contact", { contactId: "  " }],
    ["non-positive amount", { amountSat: 0 }],
    ["fractional count", { intervalCount: 1.5 }],
  ])("rejects a row with %s", (_label, overrides) => {
    expect(readRecurringPaymentOrder(row(overrides))).toBeNull();
  });
});
