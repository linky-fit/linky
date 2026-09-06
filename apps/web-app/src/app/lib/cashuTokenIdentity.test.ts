import { describe, expect, it } from "vitest";
import { readCashuTokenAliases } from "./cashuTokenIdentity";

describe("readCashuTokenAliases", () => {
  it("dedupes raw and canonical token aliases", () => {
    expect(
      readCashuTokenAliases({
        rawToken: " cashu-a ",
        token: "cashu-a",
      }),
    ).toEqual(["cashu-a"]);
  });
});
