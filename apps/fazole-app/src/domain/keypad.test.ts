import { describe, expect, it } from "vitest";
import {
  canRequestPayment,
  formatKeypadInput,
  keypadAmount,
  type KeypadKey,
  pressKeypadKey,
} from "./keypad";

const type = (keys: ReadonlyArray<KeypadKey>) =>
  keys.reduce((input, key) => pressKeypadKey(input, key), "");

describe("pressKeypadKey", () => {
  it.each<[ReadonlyArray<KeypadKey>, string, number]>([
    [["1", "2", "5"], "125", 12500],
    [["1", "2", ".", "5"], "12,5", 1250],
    [["1", ".", "2", "5", "9"], "1,25", 125],
    [[".", "5"], "0,5", 50],
    [["0", "0", "7"], "7", 700],
    [["1", ".", ".", "2"], "1,2", 120],
    [["1", "2", "⌫"], "1", 100],
    [["1", ".", "⌫"], "1", 100],
    [["⌫"], "", 0],
    [["1", "2", "C"], "", 0],
  ])("%j gives %s", (keys, input, amount) => {
    expect(type(keys)).toBe(input);
    expect(keypadAmount(type(keys))).toBe(amount);
  });

  it("stops at 1 000 000 Kč", () => {
    expect(type(["1", "0", "0", "0", "0", "0", "0", "1"])).toBe("1000000");
    expect(type(["1", "0", "0", "0", "0", "0", "0", ".", "5"])).toBe(
      "1000000,",
    );
  });
});

describe("canRequestPayment", () => {
  it("needs an amount above zero", () => {
    expect(canRequestPayment("")).toBe(false);
    expect(canRequestPayment("0,")).toBe(false);
    expect(canRequestPayment("0,01")).toBe(true);
  });
});

describe("formatKeypadInput", () => {
  it("groups thousands and keeps what was typed after the comma", () => {
    expect(formatKeypadInput("")).toBe("0");
    expect(formatKeypadInput("1234567,5")).toBe("1 234 567,5");
    expect(formatKeypadInput("12,")).toBe("12,");
  });
});
