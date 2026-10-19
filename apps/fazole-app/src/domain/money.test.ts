import { describe, expect, it } from "vitest";
import {
  CzkAmount,
  czkToSats,
  minimumCzkFor,
  parseCzkInput,
  satsToCzk,
} from "./money";

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

describe("parseCzkInput", () => {
  it("reads crowns with a comma or a dot and grouping spaces", () => {
    expect(parseCzkInput("100")).toBe(10_000);
    expect(parseCzkInput("100,5")).toBe(10_050);
    expect(parseCzkInput("1 250.05")).toBe(125_005);
  });

  it("refuses nothing, zero, three decimals and anything else", () => {
    for (const text of ["", "0", "0,00", "1,234", "abc", "-5", "1e3"]) {
      expect(parseCzkInput(text)).toBeNull();
    }
  });
});
