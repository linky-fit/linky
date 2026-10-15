import { describe, expect, it } from "vitest";
import { normalizePastedAmountInput } from "./useAmountInputKeypad";

describe("normalizePastedAmountInput", () => {
  it("accepts a whole-number amount", () => {
    expect(normalizePastedAmountInput(" 21000 ", 0)).toBe("21000");
  });

  it("normalizes a decimal comma when decimal input is enabled", () => {
    expect(normalizePastedAmountInput("12,34", 2)).toBe("12.34");
  });

  it("accepts as many decimal places as the display unit", () => {
    expect(normalizePastedAmountInput("0.00000021", 8)).toBe("0.00000021");
    expect(normalizePastedAmountInput("0.123", 2)).toBeNull();
  });

  it("rejects non-amount clipboard content", () => {
    expect(normalizePastedAmountInput("cashuA...", 0)).toBeNull();
    expect(normalizePastedAmountInput("12.34", 0)).toBeNull();
  });
});
