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

  it("describes the recovery seed as the app's 20 words", () => {
    expect(text).not.toMatch(/24 slov/u);
    expect(text).toMatch(/20 slov/u);
  });
});
