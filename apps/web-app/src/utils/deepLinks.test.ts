import { describe, expect, it } from "vitest";
import { buildCashuToken } from "../testUtils/cashuToken";
import { buildCashuDeepLink, buildCashuShareUrl } from "./deepLinks";

describe("buildCashuShareUrl", () => {
  it("builds a public cashu landing page URL with the token in the hash", () => {
    const token = buildCashuToken();

    expect(buildCashuDeepLink(token)).toBe(`cashu://${token}`);
    expect(buildCashuShareUrl(token)).toBe(
      `https://linky.fit/cashu/#${encodeURIComponent(token)}`,
    );
  });

  it("rejects invalid tokens", () => {
    expect(buildCashuShareUrl("not-a-token")).toBeNull();
  });
});
