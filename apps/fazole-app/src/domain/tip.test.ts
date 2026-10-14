import { describe, expect, it } from "vitest";
import { CzkAmount } from "./money";
import { TIP_PRESETS, tipAmount, withTip } from "./tip";

const czk = (halere: number) => CzkAmount.make(halere);

describe("tips", () => {
  it("rounds a percentage tip to whole haléře", () => {
    // 5 % of 125,50 Kč is 6,275 Kč.
    expect(tipAmount(czk(12_550), { kind: "percent", percent: 5 })).toBe(628);
    // 15 % of 0,33 Kč is 0,0495 Kč.
    expect(tipAmount(czk(33), { kind: "percent", percent: 15 })).toBe(5);
  });

  it("charges the base amount and the tip together", () => {
    expect(withTip(czk(12_550), { kind: "percent", percent: 5 })).toEqual({
      amountCzk: 13_178,
      tipCzk: 628,
    });
    expect(withTip(czk(12_550), { kind: "fixed", tipCzk: czk(2_000) })).toEqual(
      { amountCzk: 14_550, tipCzk: 2_000 },
    );
  });

  it("stores no tip when the customer gives none, or a percentage rounds to nothing", () => {
    expect(withTip(czk(12_550), { kind: "none" })).toEqual({
      amountCzk: 12_550,
      tipCzk: null,
    });
    expect(withTip(czk(1), { kind: "percent", percent: 5 })).toEqual({
      amountCzk: 1,
      tipCzk: null,
    });
  });

  it("offers 5, 10, 15 and 20 % and +20 and +50 Kč", () => {
    expect(TIP_PRESETS.map((choice) => tipAmount(czk(10_000), choice))).toEqual(
      [500, 1_000, 1_500, 2_000, 2_000, 5_000],
    );
  });
});
