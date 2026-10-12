import { SLIP39_WORD_LIST } from "./slip39WordList";

export const SLIP39_WORD_COUNT = 20;

const SUGGESTION_LIMIT = 6;
const SLIP39_WORD_SET = new Set(SLIP39_WORD_LIST);

interface Slip39WordsFill {
  /** The slot to focus next: after the last word written, or the same slot while its word is still being typed. */
  nextIndex: number;
  /** How many of the typed words found no slot. */
  overflow: number;
  words: readonly string[];
}

interface Slip39WordsAnalysis {
  filledCount: number;
  invalidIndexes: readonly number[];
  /** Every slot holds a word from the list. */
  isComplete: boolean;
  /** Completions for the slot being typed in. */
  suggestions: readonly string[];
}

const splitSlip39Input = (value: string): readonly string[] =>
  value
    .toLowerCase()
    .trim()
    .split(/[\s,;]+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 0);

export const normalizeSlip39Input = (value: string): string =>
  splitSlip39Input(value).join(" ");

export const emptySlip39Words = (): readonly string[] =>
  Array.from({ length: SLIP39_WORD_COUNT }, () => "");

export const slip39WordsToInput = (words: readonly string[]): string =>
  words.filter((word) => word.length > 0).join(" ");

/** Writes typed or pasted text into the grid from `index`; several words fan out over the following slots. */
export const fillSlip39Words = (
  words: readonly string[],
  index: number,
  value: string,
): Slip39WordsFill => {
  const tokens = splitSlip39Input(value);
  const next = [...words];
  if (tokens.length === 0) {
    next[index] = "";
    return { nextIndex: index, overflow: 0, words: next };
  }

  let written = 0;
  for (const token of tokens) {
    const slot = index + written;
    if (slot >= SLIP39_WORD_COUNT) break;
    next[slot] = token;
    written += 1;
  }

  const wordIsDone = tokens.length > 1 || /[\s,;]$/.test(value);
  return {
    nextIndex: wordIsDone
      ? Math.min(index + written, SLIP39_WORD_COUNT - 1)
      : index,
    overflow: tokens.length - written,
    words: next,
  };
};

export const analyzeSlip39Words = (
  words: readonly string[],
  activeIndex: number | null,
): Slip39WordsAnalysis => {
  const activeWord = activeIndex === null ? "" : (words[activeIndex] ?? "");
  const suggestions =
    activeWord.length > 0 && !SLIP39_WORD_SET.has(activeWord)
      ? SLIP39_WORD_LIST.filter((word) => word.startsWith(activeWord)).slice(
          0,
          SUGGESTION_LIMIT,
        )
      : [];

  const invalidIndexes = words.flatMap((word, index) => {
    if (!word || SLIP39_WORD_SET.has(word)) return [];
    // The slot being typed in stays neutral while the fragment can still become a word.
    if (index === activeIndex && suggestions.length > 0) return [];
    return [index];
  });

  return {
    filledCount: words.filter((word) => word.length > 0).length,
    invalidIndexes,
    isComplete:
      words.length === SLIP39_WORD_COUNT &&
      words.every((word) => SLIP39_WORD_SET.has(word)),
    suggestions,
  };
};
