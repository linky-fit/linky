import { describe, expect, it } from "vitest";
import { extractUniqueClaimTokens } from "./npubCashClaimResponse";

describe("extractUniqueClaimTokens", () => {
  it("dedupes the legacy single-token field against the tokens array", () => {
    expect(
      extractUniqueClaimTokens({
        error: false,
        data: {
          token: "cashuA123",
          tokens: ["cashuA123"],
        },
      }),
    ).toEqual(["cashuA123"]);
  });

  it("preserves unique tokens in response order", () => {
    expect(
      extractUniqueClaimTokens({
        error: false,
        data: {
          token: "cashuAfirst",
          tokens: ["cashuAfirst", "cashuAsecond", "  ", "cashuAthird"],
        },
      }),
    ).toEqual(["cashuAfirst", "cashuAsecond", "cashuAthird"]);
  });

  it("returns no tokens for error responses", () => {
    expect(
      extractUniqueClaimTokens({
        error: true,
        message: "No proofs to claim",
      }),
    ).toEqual([]);
  });
});
