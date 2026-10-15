// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { DECIMAL_AMOUNT_INPUT_STORAGE_KEY } from "./constants";
import { getInitialDecimalAmountInputEnabled } from "./storage";

describe("getInitialDecimalAmountInputEnabled", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("is on until the user turns it off", () => {
    expect(getInitialDecimalAmountInputEnabled()).toBe(true);
    window.localStorage.setItem(DECIMAL_AMOUNT_INPUT_STORAGE_KEY, "1");
    expect(getInitialDecimalAmountInputEnabled()).toBe(true);
  });

  it("stays off after an explicit off", () => {
    window.localStorage.setItem(DECIMAL_AMOUNT_INPUT_STORAGE_KEY, "0");
    expect(getInitialDecimalAmountInputEnabled()).toBe(false);
  });
});
