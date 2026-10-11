import { MintUrl } from "../domain/primitives";
import { planSendMint } from "./planSendMint";

const main = MintUrl.make("https://main.mint");
const big = MintUrl.make("https://big.foreign");
const small = MintUrl.make("https://small.foreign");

const balances = [
  { amount: 50, mint: main },
  { amount: 200, mint: big },
  { amount: 80, mint: small },
];

const is = (preferred: MintUrl) => (mint: MintUrl) => mint === preferred;

describe("planSendMint", () => {
  it("prefers the largest other mint over the preferred mint", () => {
    expect(
      planSendMint({ balances, amount: 40, isPreferredMint: is(main) }),
    ).toBe(big);
  });

  it("falls back to the preferred mint when no other mint covers the amount", () => {
    expect(
      planSendMint({
        balances: [
          { amount: 5, mint: big },
          { amount: 50, mint: main },
        ],
        amount: 40,
        isPreferredMint: is(main),
      }),
    ).toBe(main);
  });

  it("spends from the preferred mint last even when it is the largest", () => {
    expect(
      planSendMint({ balances, amount: 40, isPreferredMint: is(big) }),
    ).toBe(small);
  });

  describe("with the preferred mint stored under two spellings", () => {
    const upper = MintUrl.make("https://Mint.Example.com");
    const lower = MintUrl.make("https://mint.example.com");
    const spelled = [
      { amount: 100, mint: upper },
      { amount: 80, mint: lower },
      { amount: 50, mint: MintUrl.make("https://foreign.example") },
    ];
    const isPreferredMint = (mint: MintUrl) =>
      mint.toLowerCase() === "https://mint.example.com";

    it("spends every spelling of it after the other mints", () => {
      expect(
        planSendMint({ balances: spelled, amount: 40, isPreferredMint }),
      ).toBe("https://foreign.example");
    });

    it("pays from the one stored spelling with the largest balance", () => {
      expect(
        planSendMint({ balances: spelled, amount: 90, isPreferredMint }),
      ).toBe(upper);
    });
  });

  it("returns null when no single mint covers the amount or it is not positive", () => {
    expect(planSendMint({ balances, amount: 500 })).toBe(null);
    expect(planSendMint({ balances, amount: 0 })).toBe(null);
    expect(planSendMint({ balances, amount: Number.NaN })).toBe(null);
  });
});
