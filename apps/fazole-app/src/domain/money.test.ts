import { describe, expect, it } from "vitest";
import {
  CzkAmount,
  czkToSats,
  formatCzk,
  formatSats,
  minimumCzkFor,
  satsToCzk,
} from "./money";

// Intl separates digit groups and the currency with no-break spaces.
const plain = (text: string) => text.replace(/\s/gu, " ");

describe("formatCzk", () => {
  it.each<[number, string]>([
    [123450, "1 234,50 Kč"],
    [12000, "120 Kč"],
    [5, "0,05 Kč"],
  ])("formats %d", (amount, expected) => {
    expect(plain(formatCzk(CzkAmount.make(amount)))).toBe(expected);
  });

  it("formats sats with Czech grouping", () => {
    expect(plain(formatSats(12345))).toBe("12 345 sat");
  });
});

describe("czkToSats", () => {
  it("converts exactly when the amount divides evenly", () => {
    expect(czkToSats(CzkAmount.make(100_000), 2_000_000)).toBe(50_000);
  });

  it("rounds up to whole sats", () => {
    expect(czkToSats(CzkAmount.make(100), 2_345_678.9)).toBe(43);
    expect(czkToSats(CzkAmount.make(1), 2_000_000)).toBe(1);
  });

  it("returns zero for a zero amount", () => {
    expect(czkToSats(CzkAmount.make(0), 2_000_000)).toBe(0);
  });
});

describe("satsToCzk", () => {
  it("values sats in haléře at the rate", () => {
    expect(satsToCzk(50_000, 2_000_000)).toBe(100_000);
    expect(satsToCzk(43, 2_345_678.9)).toBe(101);
    expect(satsToCzk(0, 2_000_000)).toBe(0);
  });
});

describe("minimumCzkFor", () => {
  it("is the smallest amount priced at the sats or more", () => {
    const rate = 2_300_000;
    const from = minimumCzkFor(10, rate);
    expect(czkToSats(from, rate)).toBe(10);
    expect(czkToSats(CzkAmount.make(from - 1), rate)).toBe(9);
  });
});
