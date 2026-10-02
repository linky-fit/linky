import { describe, expect, it } from "vitest";
import {
  applyAmountInputKeyWithDraft,
  formatDisplayAmountParts,
  getNextDisplayCurrency,
  normalizeAllowedDisplayCurrencies,
  type DisplayAmountOptions,
} from "./displayAmounts";

const fiatRates = {
  brlPerBtc: 300_000,
  chfPerBtc: 45_000,
  czkPerBtc: 1_000_000,
  eurPerBtc: 46_000,
  fetchedAtMs: 0,
  usdPerBtc: 50_000,
};

describe("formatDisplayAmountParts", () => {
  it("formats BRL with the Brazilian unit label in Portuguese", () => {
    expect(
      formatDisplayAmountParts(100_000, {
        displayCurrency: "brl",
        fiatRates,
        lang: "pt",
      }),
    ).toMatchObject({ amountText: "300", approxPrefix: "~", unitLabel: "R$" });
    expect(
      formatDisplayAmountParts(100_000, {
        displayCurrency: "brl",
        fiatRates,
        lang: "en",
      }).unitLabel,
    ).toBe("BRL");
  });

  it("does not mark a real fiat zero as approximate", () => {
    expect(
      formatDisplayAmountParts(0, {
        displayCurrency: "czk",
        fiatRates,
        lang: "cs",
      }),
    ).toMatchObject({
      amountText: "0",
      approxPrefix: "",
      unitLabel: "Kč",
    });
  });

  it("marks a non-zero fiat amount rounded to zero as approximate", () => {
    expect(
      formatDisplayAmountParts(1, {
        displayCurrency: "usd",
        fiatRates,
        lang: "en",
      }),
    ).toMatchObject({
      amountText: "0",
      approxPrefix: "~",
      unitLabel: "USD",
    });
  });

  it("masks all amounts in hidden mode", () => {
    expect(
      formatDisplayAmountParts(123456, {
        displayCurrency: "hidden",
        fiatRates,
        lang: "cs",
      }),
    ).toMatchObject({
      amountText: "*****",
      approxPrefix: "",
      unitLabel: "",
    });
  });
});

describe("normalizeAllowedDisplayCurrencies", () => {
  it("deduplicates and drops invalid currencies", () => {
    expect(
      normalizeAllowedDisplayCurrencies(
        ["usd", "eur", "chf", "hidden", "sat", "usd", "bad"],
        "czk",
      ),
    ).toEqual(["usd", "eur", "chf", "hidden", "sat"]);
  });

  it("falls back to one currency when the list is empty", () => {
    expect(normalizeAllowedDisplayCurrencies([], "sat")).toEqual(["sat"]);
  });
});

describe("getNextDisplayCurrency", () => {
  it("cycles within the allowed currencies", () => {
    expect(getNextDisplayCurrency("czk", ["czk", "sat"])).toBe("sat");
    expect(getNextDisplayCurrency("sat", ["czk", "sat"])).toBe("czk");
    expect(getNextDisplayCurrency("usd", ["usd", "hidden"])).toBe("hidden");
  });

  it("stays on the same currency when only one is allowed", () => {
    expect(getNextDisplayCurrency("sat", ["sat"])).toBe("sat");
  });
});

describe("applyAmountInputKeyWithDraft", () => {
  it("preserves and converts two decimal places for fiat input", () => {
    const options: DisplayAmountOptions = {
      displayCurrency: "usd",
      fiatRates,
      lang: "en",
    };
    let amountSat = "";
    let displayValue: string | null = null;

    for (const key of ["1", "2", ".", "3", "4", "5"]) {
      const result = applyAmountInputKeyWithDraft(
        amountSat,
        displayValue,
        key,
        options,
        true,
      );
      amountSat = result.amountSat;
      displayValue = result.displayValue;
    }

    expect(displayValue).toBe("12.34");
    expect(amountSat).toBe("24680");
  });
});
