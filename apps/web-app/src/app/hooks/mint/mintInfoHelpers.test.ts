import { describe, expect, it } from "vitest";
import { getEncounteredMintUrls, getMintInfoIconUrl } from "./mintInfoHelpers";

describe("getMintInfoIconUrl", () => {
  it("uses the direct icon URL returned by mint info", () => {
    expect(
      getMintInfoIconUrl(
        "https://cashu.example",
        JSON.stringify({ icon_url: "https://cdn.example/mint.png" }),
      ),
    ).toBe("https://cdn.example/mint.png");
  });

  it("resolves relative icon URLs against the mint URL", () => {
    expect(
      getMintInfoIconUrl(
        "https://mint.minibits.cash/Bitcoin",
        JSON.stringify({ icon_url: "/icons/bitcoin.png" }),
      ),
    ).toBe("https://mint.minibits.cash/icons/bitcoin.png");
  });

  it("finds nested icon fields in the info payload", () => {
    expect(
      getMintInfoIconUrl(
        "https://cashu.example",
        JSON.stringify({ metadata: { iconUrl: "./mint.webp" } }),
      ),
    ).toBe("https://cashu.example/mint.webp");
  });

  it("returns null for invalid JSON", () => {
    expect(getMintInfoIconUrl("https://cashu.example", "not-json")).toBe(null);
  });
});

describe("getEncounteredMintUrls", () => {
  it("uses available proofs and ignores held, handed-out, and spent ones", () => {
    expect(
      getEncounteredMintUrls([
        { mint: "https://parsed.example/", state: "available" },
        { mint: "https://held.example", state: "held" },
        { mint: "https://out.example", state: "handedOut" },
        { mint: "https://spent.example", state: "spent" },
      ]),
    ).toEqual(["https://parsed.example"]);
  });
});
