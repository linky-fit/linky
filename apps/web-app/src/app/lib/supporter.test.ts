import { describe, expect, it } from "vitest";
import { supporterPaymentMints, supporterThemesFor } from "./supporter";

describe("supporterThemesFor", () => {
  it("unlocks the tier's theme and every lower one", () => {
    expect(supporterThemesFor("bronze")).toEqual(["bronze"]);
    expect(supporterThemesFor("silver")).toEqual(["bronze", "silver"]);
    expect(supporterThemesFor("diamond")).toEqual([
      "bronze",
      "silver",
      "gold",
      "diamond",
    ]);
  });
});

describe("supporterPaymentMints", () => {
  const accepted = ["https://cashu.cz", "https://testnut.cashu.space"];

  it("lists accepted mints that cover the amount, largest first", () => {
    expect(
      supporterPaymentMints(
        [
          { mint: "https://cashu.cz/", amount: 6_000 },
          { mint: "https://testnut.cashu.space", amount: 9_000 },
          { mint: "https://other.example", amount: 50_000 },
          { mint: "https://cashu.cz/extra", amount: 50_000 },
        ],
        5_000,
        true,
        accepted,
      ),
    ).toEqual([
      { mint: "https://testnut.cashu.space", amount: 9_000 },
      { mint: "https://cashu.cz/", amount: 6_000 },
    ]);
  });

  it("leaves out mints short of the amount and hidden test mints", () => {
    expect(
      supporterPaymentMints(
        [
          { mint: "https://cashu.cz", amount: 4_999 },
          { mint: "https://testnut.cashu.space", amount: 9_000 },
        ],
        5_000,
        false,
        accepted,
      ),
    ).toEqual([]);
  });
});
