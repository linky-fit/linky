import { describe, expect, it } from "vitest";
import {
  advertisedProxyPaymentCurrencies,
  buildProfileGeneralStatus,
  parseProfileGeneralStatus,
} from "./profileStatus";

describe("profile exchange status currencies", () => {
  it("silently removes legacy BTC and USD while preserving supported currencies", () => {
    expect(parseProfileGeneralStatus("BTC, CZK, USD").currencies).toEqual([
      "CZK",
    ]);
    expect(parseProfileGeneralStatus("CZK, EUR").currencies).toEqual([
      "CZK",
      "EUR",
    ]);
    expect(parseProfileGeneralStatus("USD").currencies).toEqual([]);
    expect(parseProfileGeneralStatus("BTC").currencies).toEqual([]);
  });
});

describe("profile general status", () => {
  it("splits the free text from the provided currencies on the last line", () => {
    expect(parseProfileGeneralStatus("Paying for lunch\nCZK, EUR")).toEqual({
      currencies: ["CZK", "EUR"],
      text: "Paying for lunch",
    });
    expect(parseProfileGeneralStatus("Just text")).toEqual({
      currencies: [],
      text: "Just text",
    });
    expect(parseProfileGeneralStatus(null)).toEqual({
      currencies: [],
      text: null,
    });
  });

  it("builds what it parses", () => {
    const status = buildProfileGeneralStatus({
      currencies: ["EUR", "CZK"],
      text: "Paying for lunch",
    });
    expect(status).toBe("Paying for lunch\nCZK, EUR");
    expect(parseProfileGeneralStatus(status).currencies).toEqual([
      "CZK",
      "EUR",
    ]);
  });
});

describe("advertised proxy payment currencies", () => {
  it("takes the listings document's list over the status, an empty one included", () => {
    expect(
      advertisedProxyPaymentCurrencies(
        { proxyPaymentCurrencies: ["EUR", "CZK"] },
        "CZK",
      ),
    ).toEqual(["CZK", "EUR"]);
    expect(
      advertisedProxyPaymentCurrencies({ proxyPaymentCurrencies: [] }, "CZK"),
    ).toEqual([]);
  });

  it("falls back on the status when the document names no list", () => {
    expect(advertisedProxyPaymentCurrencies({}, "Hi\nCZK")).toEqual(["CZK"]);
    expect(advertisedProxyPaymentCurrencies(null, "CZK, EUR")).toEqual([
      "CZK",
      "EUR",
    ]);
  });

  it("drops codes Linky does not offer", () => {
    expect(
      advertisedProxyPaymentCurrencies(
        { proxyPaymentCurrencies: ["USD", "CZK"] },
        null,
      ),
    ).toEqual(["CZK"]);
  });
});
