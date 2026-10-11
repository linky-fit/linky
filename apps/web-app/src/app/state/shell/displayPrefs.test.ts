// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  makeTestAppRegistry,
  memoryKvPorts,
} from "../../../testUtils/appRegistry";
import { displayPrefsAtom } from "./displayPrefs";

const setup = (initial?: Record<string, string>) => {
  const { items, ports } = memoryKvPorts(initial);
  return { items, registry: makeTestAppRegistry({ ports }) };
};

describe("displayPrefsAtom", () => {
  it("stores the prefs it starts from on first launch", () => {
    const { items, registry } = setup();

    const prefs = registry.get(displayPrefsAtom);

    expect(Object.fromEntries(items)).toEqual({
      "linky.lang": prefs.lang,
      "linky.display_currency.v1": prefs.displayCurrency,
      linky_use_btc_symbol: prefs.displayCurrency === "btc" ? "1" : "0",
      "linky.decimal_amount_input.v1": "0",
    });
  });

  it("stores every write under the device's storage keys", () => {
    const { items, registry } = setup({
      "linky.lang": "cs",
      "linky.display_currency.v1": "czk",
    });
    registry.get(displayPrefsAtom);

    registry.set(displayPrefsAtom, {
      lang: "de",
      displayCurrency: "btc",
      decimalAmountInputEnabled: true,
    });

    expect(Object.fromEntries(items)).toEqual({
      "linky.lang": "de",
      "linky.display_currency.v1": "btc",
      linky_use_btc_symbol: "1",
      "linky.decimal_amount_input.v1": "1",
    });
  });
});
