import { describe, expect, it } from "vitest";
import { walletBalancesOf } from "../../../testUtils/walletFakes";
import {
  planPaymentRequestMint,
  sendFeeAllowance,
  type PlanPaymentRequestMintArgs,
} from "./paymentRequestPlan";

const DEFAULT = "https://default.example";
const OTHER = "https://other.example";
const THIRD = "https://third.example";
const UNKNOWN = "https://unknown.example";
const TEST_MINT = "https://testnut.cashu.space";

const plan = (
  balances: Record<string, number>,
  overrides: Partial<PlanPaymentRequestMintArgs> = {},
) =>
  planPaymentRequestMint({
    amount: 100,
    acceptedMints: [],
    allowTestMints: false,
    balances: walletBalancesOf(balances),
    defaultMint: DEFAULT,
    userMints: [DEFAULT, OTHER, THIRD],
    ...overrides,
  });

describe("planPaymentRequestMint", () => {
  it("pays from any mint when the request names none, the default mint last", () => {
    expect(plan({ [DEFAULT]: 500, [OTHER]: 150 })).toEqual({
      _tag: "Direct",
      mint: OTHER,
      methodFee: 0,
    });
    expect(plan({ [DEFAULT]: 500, [OTHER]: 50 })).toEqual({
      _tag: "Direct",
      mint: DEFAULT,
      methodFee: 0,
    });
  });

  it("pays only from a mint the request accepts, under any spelling", () => {
    expect(
      plan(
        { [DEFAULT]: 500, ["https://OTHER.example"]: 150 },
        { acceptedMints: [DEFAULT, `${OTHER}/`] },
      ),
    ).toEqual({ _tag: "Direct", mint: "https://OTHER.example", methodFee: 0 });
    expect(
      plan({ [DEFAULT]: 500, [OTHER]: 150 }, { acceptedMints: [DEFAULT] }),
    ).toEqual({ _tag: "Direct", mint: DEFAULT, methodFee: 0 });
  });

  it("counts the send fee, so a mint holding exactly the amount does not pay directly", () => {
    expect(
      plan(
        { [OTHER]: 100, [DEFAULT]: 10_000 },
        {
          acceptedMints: [OTHER],
          sendFee: (mint) => (mint === OTHER ? 1 : 0),
        },
      ),
    ).toMatchObject({ _tag: "Lightning", targetMint: OTHER });
  });

  it("pays from a mint outside an advisory list, owing the melt fee, before going over Lightning", () => {
    expect(
      plan(
        { [OTHER]: 104 },
        { acceptedMints: [UNKNOWN], mintsAdvisory: true, outsideMintFee: 4 },
      ),
    ).toEqual({ _tag: "Direct", mint: OTHER, methodFee: 4 });
    expect(
      plan(
        { [OTHER]: 103 },
        { acceptedMints: [UNKNOWN], mintsAdvisory: true, outsideMintFee: 4 },
      ),
    ).toMatchObject({ _tag: "Lightning", targetMint: UNKNOWN });
  });

  it("owes the melt fee for a request that names no mints", () => {
    expect(plan({ [OTHER]: 102 }, { outsideMintFee: 2 })).toEqual({
      _tag: "Direct",
      mint: OTHER,
      methodFee: 2,
    });
  });

  it("keeps asking for a move into the default mint when the request accepts it", () => {
    expect(
      plan({ [DEFAULT]: 60, [OTHER]: 80 }, { acceptedMints: [DEFAULT] }),
    ).toEqual({ _tag: "NeedsMintMove", fromMint: OTHER, toMint: DEFAULT });
    expect(plan({ [DEFAULT]: 60, [OTHER]: 80 })).toEqual({
      _tag: "NeedsMintMove",
      fromMint: OTHER,
      toMint: DEFAULT,
    });
  });

  it("goes over Lightning into the first accepted mint of the user's list", () => {
    expect(
      plan(
        { [DEFAULT]: 500, [OTHER]: 300, [THIRD]: 20 },
        { acceptedMints: [UNKNOWN, THIRD] },
      ),
    ).toEqual({
      _tag: "Lightning",
      targetMint: THIRD,
      addsMint: false,
      sources: [
        { mint: OTHER, amount: 300 },
        { mint: DEFAULT, amount: 500 },
      ],
    });
  });

  it("targets the first accepted mint and adds it when the user knows none", () => {
    expect(
      plan({ [DEFAULT]: 500, [OTHER]: 100 }, { acceptedMints: [UNKNOWN] }),
    ).toEqual({
      _tag: "Lightning",
      targetMint: UNKNOWN,
      addsMint: true,
      sources: [{ mint: DEFAULT, amount: 500 }],
    });
  });

  it("refuses a move into the default mint the request does not accept", () => {
    expect(
      plan({ [DEFAULT]: 60, [OTHER]: 80 }, { acceptedMints: [UNKNOWN] }),
    ).toEqual({ _tag: "Insufficient" });
  });

  it("is insufficient when nothing covers it or the amount is not positive", () => {
    expect(plan({ [DEFAULT]: 30, [OTHER]: 40 })).toEqual({
      _tag: "Insufficient",
    });
    expect(plan({ [DEFAULT]: 500 }, { amount: 0 })).toEqual({
      _tag: "Insufficient",
    });
  });

  it("never pays from, moves into or targets a hidden test mint", () => {
    expect(plan({ [TEST_MINT]: 500 })).toEqual({ _tag: "Insufficient" });
    expect(plan({ [DEFAULT]: 500 }, { acceptedMints: [TEST_MINT] })).toEqual({
      _tag: "Insufficient",
    });
    expect(
      plan(
        { [TEST_MINT]: 500 },
        { acceptedMints: [TEST_MINT], allowTestMints: true },
      ),
    ).toEqual({ _tag: "Direct", mint: TEST_MINT, methodFee: 0 });
  });
});

describe("sendFeeAllowance", () => {
  it("is free without an input fee and grows with the amount's proof count", () => {
    expect(sendFeeAllowance(null, 100)).toBe(0);
    expect(sendFeeAllowance(0, 100)).toBe(0);
    // 100 is 7 bits, plus one proof for the fee: ceil(100 * 8 / 1000), for the payer's swap and the payee's redemption.
    expect(sendFeeAllowance(100, 100)).toBe(2);
    expect(sendFeeAllowance(1000, 100)).toBe(16);
  });
});
