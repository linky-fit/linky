import { describe, expect, it } from "vitest";
import {
  MAX_SYNCED_REMINDERS,
  reminderNotesFor,
  reminderTimesFor,
} from "./reminders";
import {
  DUE,
  HOUR,
  recurringOrderFixture,
  recurringPaymentIdFor,
} from "./testing/orders";

describe("reminderTimesFor", () => {
  it("notifies once at each unpaused next due time, soonest first", () => {
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
    ).toEqual([DUE, DUE + HOUR]);
  });

  it("drops times already past and caps the set", () => {
    expect(reminderTimesFor([recurringOrderFixture()], DUE + 1)).toEqual([]);
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
        [DUE, ["Rent", null]],
        [DUE + HOUR, ["Gym"]],
      ]),
    );
  });

  it("leaves out times already past", () => {
    expect(
      reminderNotesFor([recurringOrderFixture({ note: "Rent" })], DUE + 1),
    ).toEqual(new Map());
  });
});
