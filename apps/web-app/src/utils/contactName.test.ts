import { describe, expect, it } from "vitest";
import { getBestNostrName, formatShortNpub } from "./formatting";
import { normalizeProfileName } from "./profileName";
import { createContactNameFormatter, getContactName } from "./contactName";

const alice = "npub1gcxzte5zlkncx26j68ez60fzkvtkm9e0vrwdcvsjakxf9mu9qewqlfnj5z";
const other =
  "npub1zyxwvutsrqponmlkjihgfedcbazyxwvutsrqponmlkjihgfedcbaz123456";

describe("remote profile names", () => {
  it("strips directional controls, invisible padding and control characters", () => {
    expect(
      getBestNostrName({
        displayName: "\u202e",
        name: "  Ali\u200bce\u0000\n\t Smith\u2066  ",
      }),
    ).toBe("Alice Smith");
    expect(normalizeProfileName("\u034f\u115f\u1160\u2060\ufeff")).toBe("");
    expect(normalizeProfileName("\u200d\ufe0f")).toBe("");
  });

  it("preserves international scripts, shaping joiners, emoji and accents", () => {
    for (const name of [
      "Jiří",
      "李小龍",
      "مریم",
      "שָׁלוֹם",
      "می\u200cنا",
      "👩‍👩‍👧‍👦",
      "✈️",
    ]) {
      expect(normalizeProfileName(name)).toBe(name);
    }
    expect(normalizeProfileName("Jose\u0301")).toBe("José");
  });

  it("bounds remote names without splitting surrogate pairs", () => {
    expect(normalizeProfileName("😀".repeat(100))).toBe("😀".repeat(80));
    expect(getBestNostrName({ displayName: "\u200b", name: "fallback" })).toBe(
      "fallback",
    );
  });

  it("sanitizes legacy remote rows while preserving local overrides", () => {
    expect(getContactName({ name: "Ali\u202ece", npub: alice })).toBe("Alice");
    expect(
      getContactName({ name: "My\u200b label", npub: alice, nameSetByUser: 1 }),
    ).toBe("My\u200b label");
  });

  it("disambiguates remote collisions against local names without rewriting them", () => {
    const local = { name: "Alice", npub: alice, nameSetByUser: 1 };
    const remote = { name: "Ali\u200dce", npub: other };
    const format = createContactNameFormatter([local, remote]);
    expect(format(local)).toBe("Alice");
    expect(format(remote)).toBe(`Ali\u200dce (${formatShortNpub(other)})`);
    expect(remote.name).toBe("Ali\u200dce");
  });

  it("disambiguates both remote identities but not duplicate rows for one identity", () => {
    const first = { name: "Alice", npub: alice };
    const second = { name: "alice", npub: other };
    const format = createContactNameFormatter([first, second]);
    expect(format(first)).toBe(`Alice (${formatShortNpub(alice)})`);
    expect(format(second)).toBe(`alice (${formatShortNpub(other)})`);
    expect(createContactNameFormatter([first, first])(first)).toBe("Alice");
  });
});
