import { describe, expect, it } from "vitest";
import {
  readRecurringPaymentOrder,
  readRecurringRunRef,
  recurringOrderState,
  recurringEnvelopeKey,
  recurringProgressColumn,
  recurringRunDetails,
} from "./order";
import {
  DUE,
  HOUR,
  recurringColumnsFixture,
  recurringOrderFixture,
  recurringPaymentIdFor,
} from "./testing/orders";

describe("readRecurringPaymentOrder", () => {
  it("reads a payment", () => {
    expect(readRecurringPaymentOrder(recurringColumnsFixture())).toEqual(
      recurringOrderFixture(),
    );
  });

  it("keeps a fiat amount in its own unit and the Lightning rail", () => {
    const order = readRecurringPaymentOrder(
      recurringColumnsFixture({
        amount: 15_050,
        unit: "czk",
        rail: "lightning",
      }),
    );
    expect(order?.amount).toEqual({ amount: 15_050, unit: "czk" });
    expect(order?.rail).toBe("lightning");
  });

  it("reads a complete claim, the progress and a known run status", () => {
    const order = readRecurringPaymentOrder(
      recurringColumnsFixture({
        claimDeviceId: "device-a",
        claimAtSec: DUE - 30,
        claimDueAtSec: DUE,
        lastRunStatus: "paid",
        progress: recurringProgressColumn({
          runCount: 3,
          nextDueAtSec: DUE + 6 * HOUR,
        }),
      }),
    );
    expect(order?.claim).toEqual({
      deviceId: "device-a",
      atSec: DUE - 30,
      dueAtSec: DUE,
    });
    expect(order?.lastRunStatus).toBe("paid");
    expect(order?.schedule).toMatchObject({
      runCount: 3,
      nextDueAtSec: DUE + 6 * HOUR,
    });
  });

  it("ignores a partial claim, a blank zone and an unknown run status", () => {
    const order = readRecurringPaymentOrder(
      recurringColumnsFixture({
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
    ["unknown rail", { rail: "pigeon" }],
    ["progress that is not JSON", { progress: "3" }],
    ["progress without a due time", { progress: '{"runCount":3}' }],
    [
      "progress with a negative count",
      { progress: '{"runCount":-1,"nextDueAtSec":1800000000}' },
    ],
  ])("rejects a row with %s", (_label, overrides) => {
    expect(
      readRecurringPaymentOrder(recurringColumnsFixture(overrides)),
    ).toBeNull();
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
});

describe("recurringEnvelopeKey", () => {
  it("names a run by its payment and its number", () => {
    const id = recurringPaymentIdFor("rp-1");
    expect(recurringEnvelopeKey(id, 3)).toBe(`recurring:${id}:3`);
  });
});
