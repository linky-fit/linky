import { describe, expect, it } from "vitest";
import { buildCashuToken } from "../testUtils/cashuToken";
import {
  buildCashuDeepLink,
  buildCashuShareUrl,
  buildProfileShareUrl,
  parseNativeDeepLinkUrl,
} from "./deepLinks";

const NPUB = "npub1kkht6jvgr8mt4844saf80j5jjwyy6fdy90sxsuxt4hfv8pel499s96jvz8";

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

describe("profile share URL", () => {
  it("scans as the npub it carries", () => {
    expect(parseNativeDeepLinkUrl(buildProfileShareUrl(NPUB))?.text).toBe(
      `nostr:${NPUB}`,
    );
    expect(
      parseNativeDeepLinkUrl(`HTTPS://LINKY.FIT/P/${NPUB.toUpperCase()}/`)
        ?.text,
    ).toBe(`nostr:${NPUB}`);
  });

  it("leaves a name link and other hosts alone", () => {
    expect(parseNativeDeepLinkUrl("https://linky.fit/p/dave")).toBeNull();
    expect(parseNativeDeepLinkUrl(`https://evil.example/p/${NPUB}`)).toBeNull();
  });
});
