import { describe, expect, it } from "vitest";
import { readRecurringPaymentOrder } from "./recurringPaymentOrder";

const row = (overrides: Record<string, unknown> = {}) => ({
  id: "rp-1",
  ownerId: "owner-1",
  createdAtSec: 1_700_000_000,
  title: " Rent ",
  recipientKind: "contact",
  contactId: "contact-1",
  lnAddress: null,
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
  executorDeviceId: "device-a",
  note: null,
  ...overrides,
});

describe("readRecurringPaymentOrder", () => {
  it("reads a contact order with defaults filled in", () => {
    expect(readRecurringPaymentOrder(row())).toEqual({
      id: "rp-1",
      ownerId: "owner-1",
      createdAtSec: 1_700_000_000,
      title: "Rent",
      recipient: { kind: "contact", contactId: "contact-1" },
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
      executorDeviceId: "device-a",
      note: null,
    });
  });

  it("reads a lightning address order and a known run status", () => {
    const order = readRecurringPaymentOrder(
      row({
        recipientKind: "lnAddress",
        contactId: null,
        lnAddress: "alice@example.com",
        lastRunAtSec: 1_700_000_500,
        lastRunStatus: "paid",
        runCount: 3,
      }),
    );
    expect(order?.recipient).toEqual({
      kind: "lnAddress",
      lnAddress: "alice@example.com",
    });
    expect(order?.lastRunStatus).toBe("paid");
    expect(order?.schedule.runCount).toBe(3);
  });

  it("drops an unknown run status instead of failing the row", () => {
    expect(
      readRecurringPaymentOrder(row({ lastRunStatus: "teleported" }))
        ?.lastRunStatus,
    ).toBeNull();
  });

  it.each([
    ["unknown interval unit", { intervalUnit: "fortnight" }],
    ["missing contact id", { contactId: "  " }],
    ["unknown recipient kind", { recipientKind: "carrier-pigeon" }],
    ["blank title", { title: "  " }],
    ["non-positive amount", { amountSat: 0 }],
    ["fractional count", { intervalCount: 1.5 }],
  ])("rejects a row with %s", (_label, overrides) => {
    expect(readRecurringPaymentOrder(row(overrides))).toBeNull();
  });
});
