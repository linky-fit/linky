// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { normalizePastedAmountInput } from "./useAmountInputKeypad";

describe("normalizePastedAmountInput", () => {
  it("accepts a whole-number amount", () => {
    expect(normalizePastedAmountInput(" 21000 ", false)).toBe("21000");
  });

  it("normalizes a decimal comma when decimal input is enabled", () => {
    expect(normalizePastedAmountInput("12,34", true)).toBe("12.34");
  });

  it("rejects non-amount clipboard content", () => {
    expect(normalizePastedAmountInput("cashuA...", false)).toBeNull();
    expect(normalizePastedAmountInput("12.34", false)).toBeNull();
  });
});
