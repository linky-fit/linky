import { describe, expect, it } from "vitest";
import {
  readRecurringPaymentOrder,
  readRecurringRunRef,
  recurringOrderState,
  recurringRunDetails,
  recurringRunRecorded,
  type RecurringPaymentColumns,
} from "./order";
import {
  contactIdFor,
  DUE,
  HOUR,
  recurringOrderFixture,
  recurringPaymentIdFor,
} from "./testing/orders";

const columns = (
  overrides: Partial<RecurringPaymentColumns> = {},
): RecurringPaymentColumns => ({
  id: recurringPaymentIdFor("rp-1"),
  createdAtSec: 1_700_000_000,
  contactId: contactIdFor("contact-1"),
  amount: 21_000,
  unit: "sat",
  intervalUnit: "month",
  intervalCount: 1,
  anchorAtSec: 1_700_000_000,
  timeZone: "Europe/Prague",
  nextDueAtSec: 1_702_592_400,
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
    expect(readRecurringPaymentOrder(columns())).toEqual({
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
      columns({ amount: 15_050, unit: "czk" }),
    );
    expect(order?.amount).toEqual({ amount: 15_050, unit: "czk" });
  });

  it("reads a complete claim, the run count and a known run status", () => {
    const order = readRecurringPaymentOrder(
      columns({
        claimDeviceId: "device-a",
        claimAtSec: 1_702_592_100,
        claimDueAtSec: 1_702_592_400,
        lastRunStatus: "paid",
        runCount: 3,
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

  it("ignores a partial claim, a blank zone and an unknown run status", () => {
    const order = readRecurringPaymentOrder(
      columns({
        claimDeviceId: "device-a",
        lastRunStatus: "teleported",
        timeZone: "  ",
      }),
    );
    expect(order?.claim).toBeNull();
    expect(order?.lastRunStatus).toBeNull();
    expect(order?.schedule.timeZone).toBeNull();
  });

  it.each([
    ["unknown interval unit", { intervalUnit: "fortnight" }],
    ["unknown amount unit", { unit: "gold" }],
  ])("rejects a row with %s", (_label, overrides) => {
    expect(readRecurringPaymentOrder(columns(overrides))).toBeNull();
  });
});

describe("recurringOrderState", () => {
  it("is paused only while pausedAtSec is set", () => {
    expect(recurringOrderState(recurringOrderFixture(), DUE)).toBe("active");
    const paused = recurringOrderFixture({
      schedule: { ...recurringOrderFixture().schedule, pausedAtSec: DUE },
    });
    expect(recurringOrderState(paused, DUE + HOUR)).toBe("paused");
  });
});

describe("run references", () => {
  const run = {
    recurringPaymentId: recurringPaymentIdFor("rp-1"),
    dueAtSec: DUE,
  };

  it("round-trips through transaction details", () => {
    expect(recurringRunDetails(run)).toEqual({
      recurringPaymentId: recurringPaymentIdFor("rp-1"),
      recurringDueAtSec: DUE,
    });
    expect(recurringRunDetails(null)).toEqual({});
    expect(readRecurringRunRef(recurringRunDetails(run))).toEqual(run);
    expect(readRecurringRunRef({ requestId: "x" })).toBeNull();
    expect(
      readRecurringRunRef({
        recurringPaymentId: "not an id",
        recurringDueAtSec: DUE,
      }),
    ).toBeNull();
    expect(readRecurringRunRef(null)).toBeNull();
  });

  it("finds a recorded run unless it ended in error", () => {
    const detailsJson = JSON.stringify(recurringRunDetails(run));
    expect(
      recurringRunRecorded([{ status: "pending", detailsJson }], run),
    ).toBe(true);
    expect(recurringRunRecorded([{ status: "error", detailsJson }], run)).toBe(
      false,
    );
    expect(
      recurringRunRecorded([{ status: "ok", detailsJson: "not json" }], run),
    ).toBe(false);
    expect(
      recurringRunRecorded([{ status: "ok", detailsJson }], {
        ...run,
        dueAtSec: DUE + HOUR,
      }),
    ).toBe(false);
  });
});
