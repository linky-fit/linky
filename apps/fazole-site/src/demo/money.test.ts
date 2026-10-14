import { describe, expect, it } from "vitest";
import { formatTyped, pressKey, typedHalere, withTip } from "./money";
import { demoBip321, demoSpd } from "./qr";

const type = (keys: Parameters<typeof pressKey>[1][]) =>
  keys.reduce(pressKey, "");

describe("demo money", () => {
  it("types whole crowns, a comma and at most two haléře digits", () => {
    expect(type(["1", "2", ".", "5", "0", "9"])).toBe("12,50");
    expect(type([".", "5"])).toBe("0,5");
    expect(type(["0", "7", "⌫"])).toBe("");
    expect(typedHalere("12,5")).toBe(1250);
    expect(formatTyped("1250,5")).toBe("1 250,5");
  });

  it("charges the tip on top and rounds percentages to whole haléře", () => {
    expect(withTip(12_550, { kind: "percent", percent: 5 })).toEqual({
      totalHalere: 13_178,
      tipHalere: 628,
    });
    expect(withTip(25_000, { kind: "fixed", tipHalere: 2_000 })).toEqual({
      totalHalere: 27_000,
      tipHalere: 2_000,
    });
    expect(withTip(25_000, { kind: "none" })).toEqual({
      totalHalere: 25_000,
      tipHalere: null,
    });
  });

  it("builds QR payloads that cannot move money", () => {
    expect(demoSpd(125_050, "1234567890")).toBe(
      "SPD*1.0*ACC:CZ0000000000000123456789*AM:1250.50*CC:CZK*X-VS:1234567890*MSG:DEMO - NEPLATIT",
    );
    expect(demoBip321(6_875)).toContain("do0not0pay");
  });
});
