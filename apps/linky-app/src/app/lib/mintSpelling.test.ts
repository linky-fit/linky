import { MintUrl, planSendMint } from "@linky-fit/linkshu";
import { describe, expect, it } from "vitest";
import { isSpellingOf, storedMintSpelling } from "./mintSpelling";

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

describe("isSpellingOf", () => {
  const stored = [
    { amount: 100, mint: MintUrl.make("https://Mint.Example.com") },
    { amount: 80, mint: MintUrl.make("https://mint.example.com") },
    { amount: 60, mint: MintUrl.make("https://mint.minibits.cash") },
    { amount: 50, mint: MintUrl.make("https://foreign.example") },
  ];
  const sendMint = (defaultMint: string, amount: number) =>
    planSendMint({
      balances: stored,
      isPreferredMint: isSpellingOf(defaultMint),
      amount,
    });

  it("lets payments spend every stored spelling of the default mint last", () => {
    expect(sendMint("https://mint.example.com", 40)).toBe(
      "https://mint.minibits.cash",
    );
    expect(sendMint("https://mint.minibits.cash/Bitcoin", 40)).toBe(
      "https://Mint.Example.com",
    );
    expect(sendMint("https://mint.example.com", 70)).toBe(
      "https://Mint.Example.com",
    );
  });

  it("matches nothing without a default mint", () => {
    expect(isSpellingOf(null)("https://mint.example.com")).toBe(false);
    expect(isSpellingOf("")("")).toBe(false);
  });
});
