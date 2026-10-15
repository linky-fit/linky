import { describe, expect, it } from "vitest";
import {
  buildProfileShareUrl,
  normalizeContactSearchQuery,
  parseProfileShareUrl,
} from "./profileShareUrl";

const NPUB = "npub1kkht6jvgr8mt4844saf80j5jjwyy6fdy90sxsuxt4hfv8pel499s96jvz8";

describe("parseProfileShareUrl", () => {
  it("reads the npub out of a shared profile link", () => {
    expect(parseProfileShareUrl(buildProfileShareUrl(NPUB))).toEqual({
      kind: "npub",
      npub: NPUB,
    });
    expect(
      parseProfileShareUrl(` HTTPS://WWW.LINKY.FIT/P/${NPUB.toUpperCase()}/ `),
    ).toEqual({ kind: "npub", npub: NPUB });
    expect(
      parseProfileShareUrl(`https://linky.fit/p/${NPUB}?utm=chat#x`),
    ).toEqual({ kind: "npub", npub: NPUB });
  });

  it("reads a claimed name as its linky.fit identifier", () => {
    expect(parseProfileShareUrl("https://linky.fit/p/Dave")).toEqual({
      kind: "name",
      identifier: "dave@linky.fit",
    });
  });

  it("rejects other hosts, malformed npubs and names", () => {
    expect(parseProfileShareUrl(`https://evil.example/p/${NPUB}`)).toBeNull();
    expect(parseProfileShareUrl("https://linky.fit/p/npub1nope")).toBeNull();
    expect(parseProfileShareUrl("https://linky.fit/p/da%20ve")).toBeNull();
    expect(parseProfileShareUrl(`https://linky.fit/${NPUB}`)).toBeNull();
    expect(parseProfileShareUrl(NPUB)).toBeNull();
  });
});

describe("normalizeContactSearchQuery", () => {
  it("turns a pasted profile link into the identifier to search", () => {
    expect(normalizeContactSearchQuery(buildProfileShareUrl(NPUB))).toBe(NPUB);
    expect(normalizeContactSearchQuery("https://linky.fit/p/dave")).toBe(
      "dave@linky.fit",
    );
  });

  it("passes other input through trimmed", () => {
    expect(normalizeContactSearchQuery(` ${NPUB} `)).toBe(NPUB);
    expect(normalizeContactSearchQuery(" alice@example.com ")).toBe(
      "alice@example.com",
    );
  });
});
