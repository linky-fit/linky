import { describe, expect, it } from "vitest";
import { generateVariableSymbol } from "./variableSymbol";

describe("generateVariableSymbol", () => {
  it("generates distinct 10-digit symbols without a leading zero", () => {
    const symbols = Array.from({ length: 1000 }, generateVariableSymbol);
    for (const symbol of symbols) expect(symbol).toMatch(/^[1-9]\d{9}$/);
    expect(new Set(symbols).size).toBe(symbols.length);
  });
});
