import { describe, expect, it } from "vitest";
import {
  selectSendMintForAmount,
  storedMintSpelling,
} from "./paymentMintSelection";

const balances = [
  { amount: 50, mint: "https://main.mint" },
  { amount: 200, mint: "https://big.foreign" },
  { amount: 80, mint: "https://small.foreign" },
];

describe("selectSendMintForAmount", () => {
  it("prefers the largest foreign mint over the default mint", () => {
    expect(selectSendMintForAmount(balances, "https://main.mint", 40)).toBe(
      "https://big.foreign",
    );
  });

  it("falls back to the default mint when no foreign mint covers the amount", () => {
    const lowForeign = [
      { amount: 5, mint: "https://big.foreign" },
      { amount: 50, mint: "https://main.mint" },
    ];
    expect(selectSendMintForAmount(lowForeign, "https://main.mint", 40)).toBe(
      "https://main.mint",
    );
  });

  it("matches the preferred mint regardless of trailing slash", () => {
    expect(selectSendMintForAmount(balances, "https://big.foreign/", 40)).toBe(
      "https://small.foreign",
    );
  });

  it("recognises the default mint under the spelling linkshu stored", () => {
    const stored = [
      { amount: 100, mint: "https://Mint.Example.com" },
      { amount: 60, mint: "https://mint.minibits.cash" },
      { amount: 50, mint: "https://foreign.example" },
    ];
    expect(
      selectSendMintForAmount(stored, "https://mint.example.com", 40),
    ).toBe("https://mint.minibits.cash");
    expect(
      selectSendMintForAmount(stored, "https://mint.minibits.cash/Bitcoin", 40),
    ).toBe("https://Mint.Example.com");
  });

  it("returns null when no mint covers the amount or the amount is invalid", () => {
    expect(selectSendMintForAmount(balances, null, 500)).toBeNull();
    expect(selectSendMintForAmount(balances, null, 0)).toBeNull();
    expect(selectSendMintForAmount(balances, null, Number.NaN)).toBeNull();
  });
});

describe("storedMintSpelling", () => {
  it.each([
    ["https://Mint.Example.com", "https://mint.example.com"],
    ["https://mint.example.com/?ref=x#y", "https://mint.example.com"],
    ["https://mint.minibits.cash", "https://mint.minibits.cash/Bitcoin"],
  ])("reads %s back from the app's %s", (stored, named) => {
    const balances = [
      { amount: 70, mint: "https://other.example" },
      { amount: 30, mint: stored },
    ];
    expect(storedMintSpelling(balances, named)).toBe(stored);
  });

  it("takes the largest of several funded spellings", () => {
    const balances = [
      { amount: 20, mint: "https://mint.example.com" },
      { amount: 0, mint: "https://MINT.example.com" },
      { amount: 50, mint: "https://Mint.Example.com" },
    ];
    expect(storedMintSpelling(balances, "https://mint.example.com")).toBe(
      "https://Mint.Example.com",
    );
  });

  it("keeps an unfunded mint as named", () => {
    expect(
      storedMintSpelling(
        [{ amount: 0, mint: "https://Mint.Example.com" }],
        "https://mint.example.com",
      ),
    ).toBe("https://mint.example.com");
  });
});
