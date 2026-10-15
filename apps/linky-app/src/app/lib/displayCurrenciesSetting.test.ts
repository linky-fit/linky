import { describe, expect, it } from "vitest";
import {
  resolveDisplayCurrencies,
  toggleDisplayCurrency,
} from "./displayCurrenciesSetting";

describe("resolveDisplayCurrencies", () => {
  it("follows the device list until the setting is synced", () => {
    expect(resolveDisplayCurrencies(null, ["sat", "czk"])).toEqual([
      "sat",
      "czk",
    ]);
  });

  it("prefers the synced list over the device list", () => {
    expect(resolveDisplayCurrencies(["btc", "eur"], ["sat"])).toEqual([
      "btc",
      "eur",
    ]);
  });

  it("drops currencies this build does not know", () => {
    expect(resolveDisplayCurrencies(["usd", "doge"], ["sat"])).toEqual(["usd"]);
    expect(resolveDisplayCurrencies(["doge"], ["czk", "sat"])).toEqual(["czk"]);
  });
});

describe("toggleDisplayCurrency", () => {
  it("adds and removes a currency", () => {
    expect(toggleDisplayCurrency(["sat"], "czk")).toEqual(["sat", "czk"]);
    expect(toggleDisplayCurrency(["sat", "czk"], "sat")).toEqual(["czk"]);
  });

  it("keeps the last enabled currency", () => {
    const current: ["sat"] = ["sat"];
    expect(toggleDisplayCurrency(current, "sat")).toBe(current);
  });
});
