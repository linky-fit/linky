import { describe, expect, it } from "vitest";
import { copy } from "./copy";

const allText = (value: unknown): string[] =>
  typeof value === "string"
    ? [value]
    : typeof value === "function"
      ? [String(value)]
      : typeof value === "object" && value !== null
        ? Object.values(value).flatMap(allText)
        : [];

describe("the site copy", () => {
  const text = allText(copy).join("\n");

  it("claims no team features, which this version does not have", () => {
    expect(text).not.toMatch(/zaměstnan|tým|obsluh/iu);
  });

  it("calls bitcoin bitcoin, never Cashu", () => {
    expect(text).not.toMatch(/cashu/iu);
  });

  it("never calls the recovery seed 24 words, which the app's is not", () => {
    expect(text).not.toMatch(/24 slov/u);
  });
});
