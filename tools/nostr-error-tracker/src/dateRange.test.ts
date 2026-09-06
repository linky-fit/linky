import { describe, expect, it } from "vitest";
import { getDateRange } from "./dateRange";

const seconds = (date: string): number =>
  new Date(`${date}T00:00:00`).getTime() / 1000;

describe("getDateRange", () => {
  it("leaves empty bounds open", () => {
    expect(getDateRange("", "")).toEqual({
      since: null,
      until: null,
      error: null,
    });
    expect(getDateRange("2026-09-01", "")).toEqual({
      since: seconds("2026-09-01"),
      until: null,
      error: null,
    });
    expect(getDateRange("", "2026-09-06")).toEqual({
      since: null,
      until: seconds("2026-09-07"),
      error: null,
    });
  });

  it("includes the entire end date and allows a single calendar day", () => {
    expect(getDateRange("2026-09-06", "2026-09-06")).toEqual({
      since: seconds("2026-09-06"),
      until: seconds("2026-09-07"),
      error: null,
    });
  });

  it("advances the calendar date across month and year boundaries", () => {
    expect(getDateRange("2026-12-01", "2026-12-31").until).toBe(
      seconds("2027-01-01"),
    );
    expect(getDateRange("2024-02-29", "2024-02-29")).toEqual({
      since: seconds("2024-02-29"),
      until: seconds("2024-03-01"),
      error: null,
    });
  });

  it("uses local midnight across daylight saving changes", () => {
    for (const [day, nextDay] of [
      ["2026-03-29", "2026-03-30"],
      ["2026-10-25", "2026-10-26"],
      ["2026-03-08", "2026-03-09"],
      ["2026-11-01", "2026-11-02"],
    ]) {
      if (!day || !nextDay) throw new Error("Missing test date");
      expect(getDateRange(day, day).until).toBe(seconds(nextDay));
    }
  });

  it.each([
    ["2026-09-07", "2026-09-06"],
    ["2026-02-29", ""],
    ["", "2026-04-31"],
    ["2026-13-01", ""],
    ["2026-00-01", ""],
    ["2026-01-00", ""],
    ["26-09-06", ""],
    ["2026-9-6", ""],
    ["2026-09-06T00:00:00Z", ""],
    ["garbage", ""],
  ])("rejects invalid range %s to %s", (from, to) => {
    expect(getDateRange(from, to)).toEqual({
      since: null,
      until: null,
      error: "Enter valid dates with the start on or before the end.",
    });
  });
});
