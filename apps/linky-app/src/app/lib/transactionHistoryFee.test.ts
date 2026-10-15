import { describe, expect, it } from "vitest";
import { buildCashuToken } from "../../testUtils/cashuToken";
import { calculateTransactionHistoryFee } from "./transactionHistoryFee";

describe("calculateTransactionHistoryFee", () => {
  it("derives cashu send fee from used tokens minus sent amount minus change", () => {
    expect(
      calculateTransactionHistoryFee({
        amount: 60,
        fallbackFee: null,
        gainedTokens: [],
        usedTokens: [buildCashuToken({ amounts: [61] })],
      }),
    ).toBe(1);
  });

  it("derives lightning fee from used tokens minus lightning amount minus gained token", () => {
    expect(
      calculateTransactionHistoryFee({
        amount: 950,
        fallbackFee: null,
        gainedTokens: [buildCashuToken({ amounts: [37] })],
        usedTokens: [buildCashuToken({ amounts: [1000] })],
      }),
    ).toBe(13);
  });

  it("falls back to stored fee when old details do not contain used tokens", () => {
    expect(
      calculateTransactionHistoryFee({
        amount: 60,
        fallbackFee: 1,
        gainedTokens: [],
        usedTokens: [],
      }),
    ).toBe(1);
  });
});
