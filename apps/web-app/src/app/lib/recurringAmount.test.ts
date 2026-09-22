import { describe, expect, it } from "vitest";
import type { FiatRates } from "../../utils/displayAmounts";
import { formatDisplayAmountParts } from "../../utils/displayAmounts";
import {
  formatRecurringAmountParts,
  recurringAmountFromInput,
  recurringAmountSecondaryText,
} from "./recurringAmount";

const rates: FiatRates = {
  chfPerBtc: 90_000,
  czkPerBtc: 2_000_000,
  eurPerBtc: 100_000,
  fetchedAtMs: 1,
  usdPerBtc: 110_000,
};

describe("recurringAmountFromInput", () => {
  it("fixes the amount in the typed fiat currency, in hundredths", () => {
    expect(
      recurringAmountFromInput({
        amountSat: "7500",
        displayCurrency: "czk",
        displayValue: "150.5",
        fiatRates: rates,
      }),
    ).toEqual({ amount: 15_050, unit: "czk" });
  });

  it("converts a prefilled sat amount to the selected fiat when nothing was typed", () => {
    expect(
      recurringAmountFromInput({
        amountSat: "7500",
        displayCurrency: "czk",
        displayValue: null,
        fiatRates: rates,
      }),
    ).toEqual({ amount: 15_000, unit: "czk" });
  });

  it("stores sats when sats are selected and rejects empty input", () => {
    expect(
      recurringAmountFromInput({
        amountSat: "2100",
        displayCurrency: "sat",
        displayValue: null,
        fiatRates: rates,
      }),
    ).toEqual({ amount: 2_100, unit: "sat" });
    expect(
      recurringAmountFromInput({
        amountSat: "",
        displayCurrency: "sat",
        displayValue: null,
        fiatRates: rates,
      }),
    ).toBeNull();
  });
});

describe("formatRecurringAmountParts", () => {
  const options = (displayCurrency: "sat" | "czk" | "eur") => ({
    displayCurrency,
    fiatRates: rates,
    formatSat: (amountSat: number) =>
      formatDisplayAmountParts(amountSat, {
        displayCurrency,
        fiatRates: rates,
        lang: "en",
      }),
    lang: "en",
  });

  it("shows a fiat payment exactly in its own currency", () => {
    expect(
      formatRecurringAmountParts(
        { amount: 15_050, unit: "czk" },
        options("czk"),
      ),
    ).toEqual({ amountText: "150.5", approxPrefix: "", unitLabel: "CZK" });
  });

  it("marks a fiat payment approximate in sats and in another fiat", () => {
    expect(
      formatRecurringAmountParts(
        { amount: 15_000, unit: "czk" },
        options("sat"),
      ),
    ).toMatchObject({ amountText: "7,500", approxPrefix: "~" });
    expect(
      formatRecurringAmountParts(
        { amount: 15_000, unit: "czk" },
        options("eur"),
      ),
    ).toMatchObject({ approxPrefix: "~", unitLabel: "EUR" });
  });

  it("shows a sat payment exactly in sats and approximately in fiat", () => {
    expect(
      formatRecurringAmountParts(
        { amount: 7_500, unit: "sat" },
        options("sat"),
      ),
    ).toEqual({ amountText: "7,500", approxPrefix: "", unitLabel: "sat" });
    expect(
      formatRecurringAmountParts(
        { amount: 7_500, unit: "sat" },
        options("czk"),
      ),
    ).toMatchObject({ approxPrefix: "~", unitLabel: "CZK" });
  });

  it("adds the approximate sat side only for fiat payments", () => {
    const t = (key: string) => key;
    expect(
      recurringAmountSecondaryText(
        { amount: 15_000, unit: "czk" },
        rates,
        "en",
        t,
      ),
    ).toBe("recurringApproxSat");
    expect(
      recurringAmountSecondaryText(
        { amount: 7_500, unit: "sat" },
        rates,
        "en",
        t,
      ),
    ).toBeNull();
  });
});
