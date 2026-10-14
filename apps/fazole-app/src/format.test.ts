import { describe, expect, it } from "vitest";
import { CzkAmount } from "./domain";
import { formatCzk, numberSeparators } from "./format";

// Intl separates digit groups with no-break spaces.
const plain = (text: string) => text.replace(/\s/gu, " ");

describe("formatCzk", () => {
  it.each<[number, string]>([
    [123450, "1 234,50 Kč"],
    [12000, "120 Kč"],
    [5, "0,05 Kč"],
  ])("formats %d", (amount, expected) => {
    expect(plain(formatCzk(CzkAmount.make(amount)))).toBe(expected);
  });
});

describe("numberSeparators", () => {
  it("are the Czech ones on a Czech device", () => {
    expect(plain(numberSeparators.group)).toBe(" ");
    expect(numberSeparators.decimal).toBe(",");
  });
});
