import { describe, expect, it } from "vitest";
import {
  fiatRecurringAmount,
  isRecurringAmountUnit,
  recurringAmountSat,
  recurringFiatValue,
  type FiatRatesPerBtc,
} from "./amount";

const rates: FiatRatesPerBtc = {
  chfPerBtc: 90_000,
  czkPerBtc: 2_000_000,
  eurPerBtc: 100_000,
  usdPerBtc: 110_000,
};

describe("recurringAmountSat", () => {
  it("returns sats as they are and converts fiat at the current rate", () => {
    expect(recurringAmountSat({ amount: 2_100, unit: "sat" }, null)).toBe(
      2_100,
    );
    // 150.00 CZK at 2 000 000 CZK/BTC = 7 500 sat
    expect(recurringAmountSat({ amount: 15_000, unit: "czk" }, rates)).toBe(
      7_500,
    );
  });

  it("has no sat amount for fiat without a rate or below one sat", () => {
    expect(
      recurringAmountSat({ amount: 15_000, unit: "czk" }, null),
    ).toBeNull();
    expect(
      recurringAmountSat(
        { amount: 1, unit: "czk" },
        { ...rates, czkPerBtc: 10_000_000 },
      ),
    ).toBeNull();
  });
});

describe("fiat amounts", () => {
  it("stores hundredths and reads them back as whole units", () => {
    const amount = fiatRecurringAmount(150.5, "czk");
    expect(amount).toEqual({ amount: 15_050, unit: "czk" });
    expect(recurringFiatValue({ amount: 15_050, unit: "czk" })).toBe(150.5);
  });

  it("rejects amounts that round to nothing", () => {
    expect(fiatRecurringAmount(0.004, "eur")).toBeNull();
    expect(fiatRecurringAmount(Number.NaN, "eur")).toBeNull();
  });

  it("knows the supported units", () => {
    expect(isRecurringAmountUnit("sat")).toBe(true);
    expect(isRecurringAmountUnit("usd")).toBe(true);
    expect(isRecurringAmountUnit("gold")).toBe(false);
  });
});
