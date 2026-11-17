import { describe, expect, it } from "vitest";
import {
  applyEmojiShortcode,
  buildEmojiSearchIndex,
  getEmojiShortcodeQuery,
  loadEmojiSearchIndex,
  searchEmojis,
} from "./emojiSearch";
import { REACTION_EMOJIS } from "./reactionEmojis";

describe("searchEmojis", () => {
  it("offers 💯 first for a partly typed shortcode", async () => {
    const index = await loadEmojiSearchIndex("cs");
    expect(searchEmojis(index, "10", 1)).toEqual(["💯"]);
    expect(searchEmojis(index, "thumbsup", 1)).toEqual(["👍"]);
  });

  it("finds emojis by their name in the user's language without diacritics", async () => {
    const index = await loadEmojiSearchIndex("cs");
    expect(searchEmojis(index, "palec nahoru", 1)).toEqual(["👍"]);
    expect(searchEmojis(index, "Smich")).toContain("😂");
  });

  it("covers every catalog emoji in every language", async () => {
    for (const lang of ["cs", "de", "en", "pt"] as const) {
      const index = await loadEmojiSearchIndex(lang);
      expect(index.map((entry) => entry.emoji)).toEqual(REACTION_EMOJIS);
      expect(index.every((entry) => entry.terms.length > 0)).toBe(true);
    }
  });

  it("ranks prefix over word prefix over substring, then catalog order", () => {
    const [first, second, third, fourth, fifth] = REACTION_EMOJIS;
    const index = buildEmojiSearchIndex([
      {
        [first ?? ""]: "big cat",
        [second ?? ""]: "catalog",
        [third ?? ""]: "cat",
        [fourth ?? ""]: "dog",
        [fifth ?? ""]: "bobcat",
      },
    ]);
    expect(searchEmojis(index, "cat")).toEqual([second, third, first, fifth]);
    expect(searchEmojis(index, "  ")).toEqual([]);
  });
});

describe("getEmojiShortcodeQuery", () => {
  it.each([
    ["Super :10", { start: 6, end: 9, query: "10" }],
    [":+1", { start: 0, end: 3, query: "+1" }],
    ["ok :smích", { start: 3, end: 9, query: "smích" }],
  ])("reads the query in %j", (value, expected) => {
    expect(getEmojiShortcodeQuery(value, value.length)).toEqual(expected);
  });

  it.each(["Ahoj :)", "ok :D", "v 12:30", "Pozor:10", ":10 done", ":10:"])(
    "ignores %j",
    (value) => {
      expect(getEmojiShortcodeQuery(value, value.length)).toBeNull();
    },
  );

  it("reads only up to the caret", () => {
    expect(getEmojiShortcodeQuery("a :10 b", 5)?.query).toBe("10");
  });
});

describe("applyEmojiShortcode", () => {
  it("replaces the query with the emoji and a space, keeping the rest", () => {
    const value = "Super :10 tip";
    const query = getEmojiShortcodeQuery(value, 9);
    if (!query) throw new Error("expected a query");
    expect(applyEmojiShortcode(value, query, "💯")).toEqual({
      caret: 9,
      value: "Super 💯  tip",
    });
  });
});
