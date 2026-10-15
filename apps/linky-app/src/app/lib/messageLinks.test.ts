import { describe, expect, it } from "vitest";
import { extractMessageLinks, normalizeMessageLinkMatch } from "./messageLinks";

describe("messageLinks", () => {
  it("finds http links and trims sentence punctuation", () => {
    expect(
      extractMessageLinks("See https://example.com/docs?q=1, please."),
    ).toEqual([
      {
        displayText: "https://example.com/docs?q=1",
        end: 33,
        start: 4,
        trailingText: ",",
        url: "https://example.com/docs?q=1",
      },
    ]);
  });

  it("normalizes bare www links to https", () => {
    expect(normalizeMessageLinkMatch("www.linky.fit/cashu")).toEqual({
      displayText: "www.linky.fit/cashu",
      trailingText: "",
      url: "https://www.linky.fit/cashu",
    });
  });

  it("keeps balanced parentheses inside a URL", () => {
    expect(
      normalizeMessageLinkMatch("https://example.com/wiki/Link_(film))."),
    ).toEqual({
      displayText: "https://example.com/wiki/Link_(film)",
      trailingText: ").",
      url: "https://example.com/wiki/Link_(film)",
    });
  });
});
