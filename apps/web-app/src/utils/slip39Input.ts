import { SLIP39_WORD_LIST } from "./slip39WordList";

export const SLIP39_WORD_COUNT = 20;

const SUGGESTION_LIMIT = 6;
const SLIP39_WORD_SET = new Set(SLIP39_WORD_LIST);

interface Slip39InputAnalysis {
  activeFragment: string;
  hasSeparatorFixups: boolean;
  invalidWords: readonly string[];
  isCompleteCandidate: boolean;
  normalizedInput: string;
  suggestions: readonly string[];
  wordCount: number;
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

export const analyzeSlip39Input = (value: string): Slip39InputAnalysis => {
  const rawValue = value;
  const normalizedInput = normalizeSlip39Input(rawValue);
  const words = normalizedInput ? normalizedInput.split(" ") : [];
  const loweredInput = rawValue.toLowerCase();
  const endsWithSeparator = /[\s,;]+$/.test(loweredInput);
  const rawFragments = loweredInput.split(/[\s,;]+/);
  const activeFragment = endsWithSeparator
    ? ""
    : (rawFragments[rawFragments.length - 1] ?? "").trim();
  const prefixMatches = activeFragment
    ? SLIP39_WORD_LIST.filter((word) => word.startsWith(activeFragment)).slice(
        0,
        SUGGESTION_LIMIT,
      )
    : [];

  const invalidWords = words.filter((word, index) => {
    const isOpenPrefix =
      !endsWithSeparator &&
      index === words.length - 1 &&
      word === activeFragment &&
      prefixMatches.length > 0;

    if (isOpenPrefix) return false;
    return !SLIP39_WORD_SET.has(word);
  });

  const suggestions =
    activeFragment.length > 0 && !SLIP39_WORD_SET.has(activeFragment)
      ? prefixMatches
      : [];

  return {
    activeFragment,
    hasSeparatorFixups: /[,;\n\r]/.test(rawValue),
    invalidWords,
    isCompleteCandidate:
      words.length === SLIP39_WORD_COUNT && invalidWords.length === 0,
    normalizedInput,
    suggestions,
    wordCount: words.length,
  };
};

export const applySlip39Suggestion = (
  value: string,
  suggestion: string,
): string => {
  const normalizedSuggestion = normalizeSlip39Input(suggestion);
  if (!normalizedSuggestion) return normalizeSlip39Input(value);

  const analysis = analyzeSlip39Input(value);
  const words = analysis.normalizedInput
    ? analysis.normalizedInput.split(" ")
    : [];

  if (analysis.activeFragment && words.length > 0) {
    words[words.length - 1] = normalizedSuggestion;
    return words.join(" ");
  }

  if (words.length === 0) return normalizedSuggestion;
  return `${words.join(" ")} ${normalizedSuggestion}`;
};
