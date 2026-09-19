import { describe, expect, it } from "vitest";
import {
  dateTimeLocalToEpoch,
  describeRecurringInterval,
  epochToDateTimeLocal,
  nextFullHourSec,
  readRecurringPaymentIdFromDetails,
} from "./recurringPaymentDisplay";

describe("recurringPaymentDisplay", () => {
  it("round-trips a datetime-local value through epoch seconds", () => {
    const local = "2026-03-29T09:30";
    const epoch = dateTimeLocalToEpoch(local);
    expect(epoch).not.toBeNull();
    expect(epochToDateTimeLocal(epoch ?? 0)).toBe(local);
  });

  it("rejects malformed datetime-local input", () => {
    expect(dateTimeLocalToEpoch("")).toBeNull();
    expect(dateTimeLocalToEpoch("2026-03-29")).toBeNull();
    expect(dateTimeLocalToEpoch("tomorrow at nine")).toBeNull();
  });

  it("proposes the next full hour as the first run", () => {
    expect(nextFullHourSec(1_800_000_001)).toBe(1_800_000_000 + 3600);
    expect(nextFullHourSec(1_800_003_600)).toBe(1_800_003_600 + 3600);
  });

  it("picks singular and plural interval texts", () => {
    const t = (key: string) => key;
    expect(describeRecurringInterval({ unit: "day", count: 1 }, t)).toBe(
      "recurringEveryDay",
    );
    expect(describeRecurringInterval({ unit: "week", count: 3 }, t)).toBe(
      "recurringEveryNWeeks",
    );
  });

  it("reads the order id from transaction details", () => {
    expect(
      readRecurringPaymentIdFromDetails({ recurringPaymentId: "rp-1" }),
    ).toBe("rp-1");
    expect(readRecurringPaymentIdFromDetails({ requestId: "x" })).toBeNull();
    expect(readRecurringPaymentIdFromDetails(null)).toBeNull();
  });
});

describe("formatCountdown", () => {
  it("shows minutes and zero-padded seconds, never negative", async () => {
    const { formatCountdown } = await import("./recurringCountdown");
    expect(formatCountdown(1_000 + 299, 1_000)).toBe("4:59");
    expect(formatCountdown(1_000 + 5, 1_000)).toBe("0:05");
    expect(formatCountdown(1_000, 1_000 + 30)).toBe("0:00");
  });
});
