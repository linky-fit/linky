import {
  MintBalance,
  MintUrl,
  NonNegativeAmount,
  WalletBalances,
} from "@linky/linkshu";
import { describe, expect, it } from "vitest";
import {
  resolveAllowTestMints,
  visibleWalletBalances,
  withoutHiddenTestMints,
} from "./testMintGate";

const balance = (mint: string, amount: number) =>
  new MintBalance({
    mint: MintUrl.make(mint),
    amount: NonNegativeAmount.make(amount),
  });

const balances = new WalletBalances({
  total: NonNegativeAmount.make(700),
  spendable: NonNegativeAmount.make(500),
  perMint: [
    balance("http://localhost:3338", 500),
    balance("https://cashu.cz", 150),
    balance("https://kashu.me", 50),
  ],
});

describe("resolveAllowTestMints", () => {
  it("follows the stored value and falls back to the build default", () => {
    expect(resolveAllowTestMints("1", false)).toBe(true);
    expect(resolveAllowTestMints("0", true)).toBe(false);
    expect(resolveAllowTestMints(null, true)).toBe(true);
    expect(resolveAllowTestMints(null, false)).toBe(false);
  });
});

describe("visibleWalletBalances", () => {
  it("returns the balances untouched while test mints are allowed", () => {
    expect(visibleWalletBalances(balances, true)).toBe(balances);
  });

  it("drops test mints and recomputes total and spendable", () => {
    const visible = visibleWalletBalances(balances, false);
    expect(visible.perMint.map((entry) => entry.mint)).toEqual([
      "https://cashu.cz",
      "https://kashu.me",
    ]);
    expect(visible.total).toBe(200);
    expect(visible.spendable).toBe(150);
  });

  it("reports an empty wallet when only test mints hold funds", () => {
    const onlyTest = new WalletBalances({
      total: NonNegativeAmount.make(500),
      spendable: NonNegativeAmount.make(500),
      perMint: [balance("https://testnut.cashu.space", 500)],
    });
    const visible = visibleWalletBalances(onlyTest, false);
    expect(visible.total).toBe(0);
    expect(visible.spendable).toBe(0);
    expect(visible.perMint).toEqual([]);
  });
});

describe("withoutHiddenTestMints", () => {
  it("filters items by their mint only when test mints are off", () => {
    const items = [
      { mint: "http://127.0.0.1:3338" },
      { mint: "https://cashu.cz" },
    ];
    expect(withoutHiddenTestMints(items, true)).toBe(items);
    expect(withoutHiddenTestMints(items, false)).toEqual([
      { mint: "https://cashu.cz" },
    ]);
  });
});
