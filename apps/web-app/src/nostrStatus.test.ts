import { describe, expect, it } from "vitest";
import { parseProfileGeneralStatus } from "./nostrStatus";

describe("profile exchange status currencies", () => {
  it("silently removes legacy USD while preserving supported currencies", () => {
    expect(parseProfileGeneralStatus("BTC, CZK, USD").currencies).toEqual([
      "BTC",
      "CZK",
    ]);
    expect(parseProfileGeneralStatus("USD").currencies).toEqual([]);
  });
});
