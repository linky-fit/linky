import { describe, expect, it } from "vitest";
import {
  analyzeSlip39Words,
  emptySlip39Words,
  fillSlip39Words,
  normalizeSlip39Input,
  SLIP39_WORD_COUNT,
  slip39WordsToInput,
} from "./slip39Input";

const SHARE =
  "academic acid acne acquire acrobat activity actress adapt adequate adjust admit adorn adult advance advocate afraid again agency agree aide";
const SHARE_WORDS = SHARE.split(" ");

describe("normalizeSlip39Input", () => {
  it("normalizes commas and mixed whitespace into spaces", () => {
    expect(
      normalizeSlip39Input("  academic,ACID\nacne   acquire ; acrobat "),
    ).toBe("academic acid acne acquire acrobat");
  });
});

describe("fillSlip39Words", () => {
  it("keeps a word being typed in its slot", () => {
    const fill = fillSlip39Words(emptySlip39Words(), 2, "Acad");
    expect(fill.words[2]).toBe("acad");
    expect(fill.nextIndex).toBe(2);
  });

  it("moves on once a separator ends the word", () => {
    const fill = fillSlip39Words(emptySlip39Words(), 2, "academic ");
    expect(fill.words[2]).toBe("academic");
    expect(fill.nextIndex).toBe(3);
  });

  it("fans a pasted phrase out over the following slots", () => {
    const fill = fillSlip39Words(emptySlip39Words(), 1, "acid, acne\nacquire");
    expect(fill.words.slice(0, 5)).toEqual(["", "acid", "acne", "acquire", ""]);
    expect(fill.nextIndex).toBe(4);
    expect(fill.overflow).toBe(0);
  });

  it("drops the words that find no slot and counts them", () => {
    const fill = fillSlip39Words(emptySlip39Words(), 18, "acid acne acquire");
    expect(fill.words.slice(18)).toEqual(["acid", "acne"]);
    expect(fill.nextIndex).toBe(SLIP39_WORD_COUNT - 1);
    expect(fill.overflow).toBe(1);
  });

  it("clears a slot emptied by the user", () => {
    const fill = fillSlip39Words(SHARE_WORDS, 4, " ");
    expect(fill.words[4]).toBe("");
    expect(fill.nextIndex).toBe(4);
  });
});

describe("analyzeSlip39Words", () => {
  it("keeps the slot being typed in neutral while it matches a prefix", () => {
    const words = fillSlip39Words(emptySlip39Words(), 0, "ac").words;
    const analysis = analyzeSlip39Words(words, 0);
    expect(analysis.invalidIndexes).toEqual([]);
    expect(analysis.suggestions).toContain("acid");
  });

  it("flags unknown words elsewhere, and the typed slot once it matches nothing", () => {
    const words = [...emptySlip39Words()];
    words[0] = "nope";
    words[1] = "xq";
    expect(analyzeSlip39Words(words, 1).invalidIndexes).toEqual([0, 1]);
    expect(analyzeSlip39Words(words, 1).suggestions).toEqual([]);
  });

  it("is complete only when every slot holds a listed word", () => {
    expect(analyzeSlip39Words(SHARE_WORDS, null)).toMatchObject({
      filledCount: SLIP39_WORD_COUNT,
      invalidIndexes: [],
      isComplete: true,
    });
    const missingOne = [...SHARE_WORDS];
    missingOne[7] = "";
    expect(analyzeSlip39Words(missingOne, null)).toMatchObject({
      filledCount: SLIP39_WORD_COUNT - 1,
      isComplete: false,
    });
  });
});

describe("slip39WordsToInput", () => {
  it("joins the filled slots with single spaces", () => {
    expect(slip39WordsToInput(["academic", "", "acid"])).toBe("academic acid");
  });
});
