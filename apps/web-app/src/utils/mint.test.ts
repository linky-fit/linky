import { describe, expect, it } from "vitest";
import {
  GENERIC_MINT_ICON_DATA_URL,
  getNextMintIconUrl,
  isTestMintUrl,
} from "./mint";

describe("getNextMintIconUrl", () => {
  it("falls back to favicon before the generic placeholder", () => {
    expect(
      getNextMintIconUrl(
        "https://cdn.example/icon.png",
        "https://cashu.example",
      ),
    ).toBe("https://cashu.example/favicon.ico");
  });

  it("falls back to the generic placeholder after favicon fails", () => {
    expect(
      getNextMintIconUrl(
        "https://cashu.example/favicon.ico",
        "https://cashu.example",
      ),
    ).toBe(GENERIC_MINT_ICON_DATA_URL);
  });

  it("returns null when the generic placeholder already failed", () => {
    expect(getNextMintIconUrl(GENERIC_MINT_ICON_DATA_URL, null)).toBe(null);
  });
});

describe("isTestMintUrl", () => {
  it("identifies the offered test mint", () => {
    expect(isTestMintUrl("https://testnut.cashu.space/")).toBe(true);
  });

  it("does not flag production mints", () => {
    expect(isTestMintUrl("https://cashu.cz")).toBe(false);
  });
});
