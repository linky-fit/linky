import { describe, expect, it } from "vitest";
import { MAX_SYNCED_REMINDERS, reminderTimesFor } from "./reminders";
import {
  DUE,
  HOUR,
  recurringOrderFixture,
  recurringPaymentIdFor,
} from "./testing/orders";
import { RECURRING_NOTICE_SEC } from "./tick";

describe("reminderTimesFor", () => {
  it("notifies the notice window before each unpaused next due time, soonest first", () => {
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
    expect(
      reminderTimesFor(
        [later, paused, recurringOrderFixture()],
        DUE - 2 * HOUR,
      ),
    ).toEqual([DUE - RECURRING_NOTICE_SEC, DUE + HOUR - RECURRING_NOTICE_SEC]);
  });

  it("drops times already past and caps the set", () => {
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
