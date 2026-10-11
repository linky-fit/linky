import { MintUrl } from "../domain/primitives";
import { mintMoveCovers, planMintMove } from "./planMintMove";

const main = MintUrl.make("https://main.example");
const small = MintUrl.make("https://small.example");
const large = MintUrl.make("https://large.example");

describe("planMintMove", () => {
  it("sweeps the largest other mint into the target", () => {
    expect(
      planMintMove({
        toMint: main,
        balances: [
          { mint: main, amount: 40 },
          { mint: small, amount: 20 },
          { mint: large, amount: 80 },
        ],
      }),
    ).toEqual({
      fromMint: large,
      toMint: main,
      sourceBalance: 80,
      targetBalance: 40,
      maxBalanceAfterMove: 120,
    });
  });

  it("returns null when no other mint holds funds", () => {
    expect(
      planMintMove({
        toMint: main,
        balances: [
          { mint: main, amount: 40 },
          { mint: small, amount: 0 },
        ],
      }),
    ).toBeNull();
  });
});

describe("mintMoveCovers", () => {
  const plan = planMintMove({
    toMint: main,
    balances: [
      { mint: main, amount: 40 },
      { mint: large, amount: 80 },
    ],
  });

  it("holds only when no single mint covers the amount but the move does", () => {
    expect(mintMoveCovers({ plan, amount: 100, spendable: 80 })).toBe(true);
    expect(mintMoveCovers({ plan, amount: 70, spendable: 80 })).toBe(false);
    expect(mintMoveCovers({ plan, amount: 121, spendable: 80 })).toBe(false);
    expect(mintMoveCovers({ plan: null, amount: 100, spendable: 80 })).toBe(
      false,
    );
  });
});
