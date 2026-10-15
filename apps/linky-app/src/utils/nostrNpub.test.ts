import { describe, expect, it } from "vitest";
import { normalizeNpubIdentifier } from "./nostrNpub";

const NPUB = "npub1ds24l0swau3y5z52rap9dde3jg9nuq4lqeutnsuzrscmqkt8zv0q8r3n6l";

describe("normalizeNpubIdentifier", () => {
  it("ignores any address suffix after an npub", () => {
    expect(normalizeNpubIdentifier(`${NPUB}@npub.cash`)).toBe(NPUB);
    expect(normalizeNpubIdentifier(`${NPUB}@linky.fit`)).toBe(NPUB);
    expect(normalizeNpubIdentifier(`${NPUB}@example.com`)).toBe(NPUB);
  });

  it("keeps ordinary at-sign identifiers out of the npub flow", () => {
    expect(normalizeNpubIdentifier("alice@example.com")).toBeNull();
  });

  it("supports the nostr URI prefix with an address suffix", () => {
    expect(normalizeNpubIdentifier(`nostr:${NPUB}@example.com`)).toBe(NPUB);
  });
});
