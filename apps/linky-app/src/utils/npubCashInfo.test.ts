import { describe, expect, it } from "vitest";
import { parseNpubCashProfileInfo } from "./npubCashInfo";

describe("parseNpubCashProfileInfo", () => {
  it("reads the mint url and the bought name from the v2 user info", () => {
    expect(
      parseNpubCashProfileInfo({
        error: false,
        data: {
          user: {
            pubkey: "ab".repeat(32),
            name: "Alice42",
            mintUrl: "https://minibits.cash/Bitcoin",
            lockQuote: false,
          },
        },
      }),
    ).toEqual({
      mintUrl: "https://minibits.cash/Bitcoin",
      ownedLightningAddresses: ["alice42@linky.fit"],
    });
  });

  it("owns no address while the user has no name", () => {
    expect(
      parseNpubCashProfileInfo({
        error: false,
        data: { user: { mintUrl: "https://cashu.cz", lockQuote: false } },
      }),
    ).toEqual({ mintUrl: "https://cashu.cz", ownedLightningAddresses: [] });
  });
});
