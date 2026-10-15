import { describe, expect, it } from "vitest";
import {
  buildOwnProfileShareUrl,
  readAddContactNpubFromHash,
} from "./sharedProfileLink";

const NPUB = "npub1kkht6jvgr8mt4844saf80j5jjwyy6fdy90sxsuxt4hfv8pel499s96jvz8";

describe("readAddContactNpubFromHash", () => {
  it("reads a valid npub in any case", () => {
    expect(readAddContactNpubFromHash(`#add/${NPUB}`)).toBe(NPUB);
    expect(readAddContactNpubFromHash(`#add/${NPUB.toUpperCase()}`)).toBe(NPUB);
  });

  it("rejects anything that is not one valid npub", () => {
    expect(readAddContactNpubFromHash(`#add/${NPUB.slice(0, -1)}x`)).toBeNull();
    expect(readAddContactNpubFromHash(`#add/${NPUB}/chat`)).toBeNull();
    expect(readAddContactNpubFromHash(`#contact/${NPUB}`)).toBeNull();
  });
});

describe("buildOwnProfileShareUrl", () => {
  it("uses the claimed linky.fit name", () => {
    expect(
      buildOwnProfileShareUrl(NPUB, "Dave@linky.fit", ["dave@linky.fit"]),
    ).toBe("https://linky.fit/p/dave");
  });

  it("falls back to the npub for an address the user doesn't own", () => {
    const npubUrl = `https://linky.fit/p/${NPUB}`;
    expect(buildOwnProfileShareUrl(NPUB, "dave@linky.fit", [])).toBe(npubUrl);
    expect(
      buildOwnProfileShareUrl(NPUB, "dave@other.com", ["dave@other.com"]),
    ).toBe(npubUrl);
    expect(buildOwnProfileShareUrl(NPUB, null, [])).toBe(npubUrl);
  });
});
