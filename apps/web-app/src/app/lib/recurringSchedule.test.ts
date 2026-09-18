import { describe, expect, it } from "vitest";
import {
  advanceRecurringSchedule,
  currentTimeZone,
  decideRecurringRun,
  isValidRecurringInterval,
  nextRecurringOccurrenceAfter,
  recurringDueAt,
  resolveTimeZone,
  type RecurringScheduleState,
} from "./recurringSchedule";

const PRAGUE = "Europe/Prague";
const utc = (
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
): number => Date.UTC(year, month - 1, day, hour, minute) / 1000;

// 2026 DST in Prague: starts 03-29 01:00Z (CET → CEST), ends 10-25 01:00Z.
describe("recurringSchedule", () => {
  describe("recurringDueAt", () => {
    it("adds hours to the instant regardless of zone", () => {
      const anchor = utc(2026, 3, 28, 23, 15);
      expect(
        recurringDueAt(anchor, { unit: "hour", count: 6 }, 1, PRAGUE),
      ).toBe(anchor + 6 * 3600);
      expect(
        recurringDueAt(anchor, { unit: "hour", count: 6 }, 0, PRAGUE),
      ).toBe(anchor);
    });

    it("keeps the wall clock across a DST start for daily steps", () => {
      const anchor = utc(2026, 3, 28, 8); // 09:00 CET
      expect(recurringDueAt(anchor, { unit: "day", count: 1 }, 1, PRAGUE)).toBe(
        utc(2026, 3, 29, 7), // 09:00 CEST, 23 hours later
      );
    });

    it("keeps the wall clock across a DST end for weekly steps", () => {
      const anchor = utc(2026, 10, 20, 16, 30); // Tue 18:30 CEST
      expect(
        recurringDueAt(anchor, { unit: "week", count: 1 }, 1, PRAGUE),
      ).toBe(
        utc(2026, 10, 27, 17, 30), // Tue 18:30 CET
      );
    });

    it("clamps a month-end anchor per month without drifting", () => {
      const anchor = utc(2026, 1, 31, 8); // Jan 31 09:00 CET
      const monthly = { unit: "month", count: 1 } as const;
      expect(recurringDueAt(anchor, monthly, 1, PRAGUE)).toBe(
        utc(2026, 2, 28, 8),
      );
      expect(recurringDueAt(anchor, monthly, 2, PRAGUE)).toBe(
        utc(2026, 3, 31, 7),
      );
      expect(recurringDueAt(anchor, monthly, 3, PRAGUE)).toBe(
        utc(2026, 4, 30, 7),
      );
      expect(recurringDueAt(anchor, monthly, 12, PRAGUE)).toBe(
        utc(2027, 1, 31, 8),
      );
    });

    it("carries multi-month steps across a year boundary", () => {
      const anchor = utc(2026, 11, 15, 11); // Nov 15 12:00 CET
      expect(
        recurringDueAt(anchor, { unit: "month", count: 3 }, 1, PRAGUE),
      ).toBe(utc(2027, 2, 15, 11));
    });

    it("moves a wall clock inside the DST gap to after the gap", () => {
      const anchor = utc(2026, 3, 28, 1, 30); // 02:30 CET, exists
      expect(recurringDueAt(anchor, { unit: "day", count: 1 }, 1, PRAGUE)).toBe(
        utc(2026, 3, 29, 1, 30), // 02:30 CEST does not exist → 03:30 CEST
      );
    });

    it("resolves an ambiguous wall clock to the post-transition offset", () => {
      const anchor = utc(2026, 10, 24, 0, 30); // 02:30 CEST
      expect(recurringDueAt(anchor, { unit: "day", count: 1 }, 1, PRAGUE)).toBe(
        utc(2026, 10, 25, 1, 30), // second 02:30 that night, CET
      );
    });
  });

  describe("nextRecurringOccurrenceAfter", () => {
    const anchor = utc(2026, 1, 31, 8);
    const monthly = { unit: "month", count: 1 } as const;

    it("finds the first due time strictly after the given instant", () => {
      expect(
        nextRecurringOccurrenceAfter(anchor, monthly, utc(2026, 6, 15), PRAGUE),
      ).toEqual({ occurrence: 5, dueAtSec: utc(2026, 6, 30, 7) });
    });

    it("steps past an instant that is itself a due time", () => {
      expect(
        nextRecurringOccurrenceAfter(
          anchor,
          monthly,
          utc(2026, 2, 28, 8),
          PRAGUE,
        ),
      ).toEqual({ occurrence: 2, dueAtSec: utc(2026, 3, 31, 7) });
    });

    it("returns the anchor when asked about an earlier instant", () => {
      expect(
        nextRecurringOccurrenceAfter(anchor, monthly, anchor - 1, PRAGUE),
      ).toEqual({ occurrence: 0, dueAtSec: anchor });
    });

    it("stays exact far from the anchor despite the rough estimate", () => {
      const after = utc(2036, 6, 1);
      const found = nextRecurringOccurrenceAfter(
        anchor,
        monthly,
        after,
        PRAGUE,
      );
      expect(found.dueAtSec).toBe(utc(2036, 6, 30, 7));
      expect(
        recurringDueAt(anchor, monthly, found.occurrence - 1, PRAGUE),
      ).toBeLessThanOrEqual(after);
    });
  });

  describe("decideRecurringRun", () => {
    const anchor = utc(2026, 1, 1, 8); // daily 09:00 CET
    const base: RecurringScheduleState = {
      anchorAtSec: anchor,
      interval: { unit: "day", count: 1 },
      timeZone: PRAGUE,
      nextDueAtSec: anchor,
      runCount: 0,
      maxRuns: null,
      endAtSec: null,
      pausedAtSec: null,
    };

    it("waits until the next due time", () => {
      expect(decideRecurringRun(base, anchor - 1)).toEqual({
        kind: "wait",
        untilSec: anchor,
      });
    });

    it("is due exactly at the due time with nothing missed", () => {
      expect(decideRecurringRun(base, anchor)).toEqual({
        kind: "due",
        dueAtSec: anchor,
        missedCount: 0,
      });
    });

    it("pays once and counts the due times that passed meanwhile", () => {
      expect(decideRecurringRun(base, utc(2026, 1, 4, 11))).toEqual({
        kind: "due",
        dueAtSec: anchor,
        missedCount: 3, // Jan 2, 3, 4 are skipped
      });
    });

    it("reports paused before anything else", () => {
      expect(
        decideRecurringRun({ ...base, pausedAtSec: anchor }, utc(2026, 2, 1)),
      ).toEqual({ kind: "paused" });
    });

    it("finishes when the run limit is reached", () => {
      expect(
        decideRecurringRun(
          { ...base, maxRuns: 2, runCount: 2 },
          utc(2026, 2, 1),
        ),
      ).toEqual({ kind: "finished", reason: "maxRuns" });
    });

    it("finishes when the next due time is past the end", () => {
      const state = { ...base, endAtSec: utc(2026, 1, 1, 12) };
      expect(decideRecurringRun(state, anchor)).toEqual({
        kind: "due",
        dueAtSec: anchor,
        missedCount: 0,
      });
      expect(
        decideRecurringRun(
          { ...state, nextDueAtSec: utc(2026, 1, 2, 8) },
          anchor,
        ),
      ).toEqual({ kind: "finished", reason: "endAt" });
    });
  });

  describe("advanceRecurringSchedule", () => {
    it("moves to the first due time after now and counts the run", () => {
      const anchor = utc(2026, 1, 1, 8);
      const state: RecurringScheduleState = {
        anchorAtSec: anchor,
        interval: { unit: "day", count: 1 },
        timeZone: PRAGUE,
        nextDueAtSec: anchor,
        runCount: 4,
        maxRuns: null,
        endAtSec: null,
        pausedAtSec: null,
      };
      expect(advanceRecurringSchedule(state, utc(2026, 1, 4, 11))).toEqual({
        nextDueAtSec: utc(2026, 1, 5, 8),
        runCount: 5,
      });
    });
  });

  describe("validation and zones", () => {
    it("accepts whole counts within bounds and rejects the rest", () => {
      expect(isValidRecurringInterval({ unit: "hour", count: 1 })).toBe(true);
      expect(isValidRecurringInterval({ unit: "month", count: 999 })).toBe(
        true,
      );
      expect(isValidRecurringInterval({ unit: "hour", count: 0 })).toBe(false);
      expect(isValidRecurringInterval({ unit: "day", count: 1.5 })).toBe(false);
      expect(isValidRecurringInterval({ unit: "week", count: 1000 })).toBe(
        false,
      );
    });

    it("keeps a known zone and falls back to the device zone otherwise", () => {
      expect(resolveTimeZone(PRAGUE)).toBe(PRAGUE);
      expect(resolveTimeZone("Mars/Olympus_Mons")).toBe(currentTimeZone());
      expect(resolveTimeZone(null)).toBe(currentTimeZone());
    });
  });
});
