import { describe, expect, it } from "vitest";
import { resolveLanguage } from "./language";

describe("resolveLanguage", () => {
  it.each<[string, "cs" | "en"]>([
    ["cs-CZ", "cs"],
    ["cs", "cs"],
    ["en-US", "en"],
    ["sk-SK", "en"],
    ["de-DE", "en"],
    ["", "en"],
  ])("follows a %s device", (device, expected) => {
    expect(resolveLanguage(null, device)).toBe(expected);
  });

  it("keeps the merchant's choice over the device's language", () => {
    expect(resolveLanguage("en", "cs-CZ")).toBe("en");
    expect(resolveLanguage("cs", "en-US")).toBe("cs");
  });

  it("ignores a stored value it does not know", () => {
    expect(resolveLanguage("de", "cs-CZ")).toBe("cs");
  });
});
