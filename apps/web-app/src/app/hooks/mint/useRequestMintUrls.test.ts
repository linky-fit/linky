import { describe, expect, it } from "vitest";
import { MAIN_MINT_URL } from "../../../utils/mint";
import { requestMintUrls } from "./useRequestMintUrls";

describe("requestMintUrls", () => {
  it("lists the default mint first, then the user's other mints once", () => {
    expect(
      requestMintUrls({
        allowTestMints: false,
        defaultMintUrl: "https://default.example/",
        mintUrls: [
          "https://other.example",
          "https://default.example",
          "https://other.example/",
        ],
      }),
    ).toEqual(["https://default.example", "https://other.example"]);
  });

  it("leaves out hidden test mints and falls back to the main mint", () => {
    expect(
      requestMintUrls({
        allowTestMints: false,
        defaultMintUrl: null,
        mintUrls: ["https://testnut.cashu.space"],
      }),
    ).toEqual([MAIN_MINT_URL]);
  });
});
