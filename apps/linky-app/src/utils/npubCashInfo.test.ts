import { describe, expect, it } from "vitest";
import { parseNpubCashProfileInfo } from "./npubCashInfo";

describe("parseNpubCashProfileInfo", () => {
  it("parses direct mint url and username from the hosted info response", () => {
    expect(
      parseNpubCashProfileInfo({
        mintUrl: "https://minibits.cash/Bitcoin",
        username: "Alice42",
      }),
    ).toEqual({
      mintUrl: "https://minibits.cash/Bitcoin",
      ownedLightningAddresses: ["alice42@linky.fit"],
    });
  });

  it("parses wrapped data responses and keeps missing usernames empty", () => {
    expect(
      parseNpubCashProfileInfo({
        data: {
          mintURL: "https://cashu.cz",
        },
      }),
    ).toEqual({
      mintUrl: "https://cashu.cz",
      ownedLightningAddresses: [],
    });
  });
});
