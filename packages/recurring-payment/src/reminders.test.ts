import { describe, expect, it } from "vitest";
import {
  MAX_SYNCED_REMINDERS,
  RECURRING_REMINDER_GRACE_SEC,
  reminderNotesFor,
  reminderTimesFor,
} from "./reminders";
import {
  DUE,
  HOUR,
  recurringOrderFixture,
  recurringPaymentIdFor,
} from "./testing/orders";

const GRACE = RECURRING_REMINDER_GRACE_SEC;

describe("reminderTimesFor", () => {
  it("notifies once a grace after each unpaused next due time, soonest first", () => {
    const later = recurringOrderFixture({
      id: recurringPaymentIdFor("rp-2"),
      schedule: {
        ...recurringOrderFixture().schedule,
        nextDueAtSec: DUE + HOUR,
      },
    });
    const paused = recurringOrderFixture({
      id: recurringPaymentIdFor("rp-3"),
      schedule: {
        ...recurringOrderFixture().schedule,
        pausedAtSec: DUE - HOUR,
      },
    });
    const sameTime = recurringOrderFixture({
      id: recurringPaymentIdFor("rp-4"),
    });
    expect(
      reminderTimesFor(
        [later, paused, recurringOrderFixture(), sameTime],
        DUE - 2 * HOUR,
      ),
    ).toEqual([DUE + GRACE, DUE + HOUR + GRACE]);
  });

  it("drops an order once its due time arrives and caps the set", () => {
    expect(reminderTimesFor([recurringOrderFixture()], DUE - 1)).toEqual([
      DUE + GRACE,
    ]);
    expect(reminderTimesFor([recurringOrderFixture()], DUE)).toEqual([]);
    const many = Array.from({ length: MAX_SYNCED_REMINDERS + 5 }, (_, index) =>
      recurringOrderFixture({
        id: recurringPaymentIdFor(`rp-${index}`),
        schedule: {
          ...recurringOrderFixture().schedule,
          nextDueAtSec: DUE + index * HOUR,
        },
      }),
    );
    expect(reminderTimesFor(many, DUE - HOUR)).toHaveLength(
      MAX_SYNCED_REMINDERS,
    );
  });
});

describe("reminderNotesFor", () => {
  it("lists the note of every unpaused order due at each reminder time", () => {
    const rent = recurringOrderFixture({ note: "Rent" });
    const unnamed = recurringOrderFixture({
      id: recurringPaymentIdFor("rp-2"),
    });
    const later = recurringOrderFixture({
      id: recurringPaymentIdFor("rp-3"),
      note: "Gym",
      schedule: {
        ...recurringOrderFixture().schedule,
        nextDueAtSec: DUE + HOUR,
      },
    });
    const paused = recurringOrderFixture({
      id: recurringPaymentIdFor("rp-4"),
      note: "Paused",
      schedule: {
        ...recurringOrderFixture().schedule,
        pausedAtSec: DUE - HOUR,
      },
    });
    expect(
      reminderNotesFor([rent, unnamed, later, paused], DUE - HOUR),
    ).toEqual(
      new Map([
        [DUE + GRACE, ["Rent", null]],
        [DUE + HOUR + GRACE, ["Gym"]],
      ]),
    );
  });

  it("leaves out orders already due", () => {
    expect(
      reminderNotesFor([recurringOrderFixture({ note: "Rent" })], DUE),
    ).toEqual(new Map());
  });
});
