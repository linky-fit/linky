import type { Lang } from "../../utils/lang";
import { REACTION_EMOJIS } from "./reactionEmojis";

/** Emoji → its `|`-joined name, shortcodes and keywords. */
type EmojiKeywords = Readonly<Record<string, string>>;

// Generated for REACTION_EMOJIS from emojibase-data 18.0.0 (English names,
// tags, GitHub and Slack shortcodes) and CLDR 49 annotations (other languages).
// Each language is its own chunk, loaded on the first search.
const keywordLoaders: Record<Lang, () => Promise<EmojiKeywords>> = {
  cs: () => import("./emojiKeywords/cs.json").then((data) => data.default),
  de: () => import("./emojiKeywords/de.json").then((data) => data.default),
  en: () => import("./emojiKeywords/en.json").then((data) => data.default),
  pt: () => import("./emojiKeywords/pt.json").then((data) => data.default),
};

export interface EmojiSearchEntry {
  readonly emoji: string;
  /** Lowercased, without diacritics. */
  readonly terms: readonly string[];
}

/** The searchable emojis in catalog order. */
export type EmojiSearchIndex = readonly EmojiSearchEntry[];

const normalizeEmojiSearchText = (value: string): string =>
  value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase().trim();

export const buildEmojiSearchIndex = (
  keywordSets: readonly EmojiKeywords[],
): EmojiSearchIndex =>
  REACTION_EMOJIS.map((emoji) => ({
    emoji,
    terms: [
      ...new Set(
        keywordSets.flatMap((keywords) =>
          (keywords[emoji] ?? "").split("|").map(normalizeEmojiSearchText),
        ),
      ),
    ].filter(Boolean),
  }));

const indexes = new Map<Lang, Promise<EmojiSearchIndex>>();

/** English always joins the user's language, so `:thumbsup` and other shortcodes work everywhere. */
export const loadEmojiSearchIndex = (lang: Lang): Promise<EmojiSearchIndex> => {
  const cached = indexes.get(lang);
  if (cached) return cached;
  const languages: Lang[] = lang === "en" ? ["en"] : [lang, "en"];
  const loading = Promise.all(languages.map((code) => keywordLoaders[code]()))
    .then(buildEmojiSearchIndex)
    .catch((error: unknown) => {
      // A chunk that failed to load, e.g. offline before it was cached, is retried on the next search.
      indexes.delete(lang);
      throw error;
    });
  indexes.set(lang, loading);
  return loading;
};

const termRank = (term: string, query: string): number => {
  if (term.startsWith(query)) return 0;
  if (term.split(/[\s:_-]+/u).some((word) => word.startsWith(query))) return 1;
  return term.includes(query) ? 2 : Number.POSITIVE_INFINITY;
};

/**
 * Emojis whose name, shortcode or keyword matches `query`: prefixes first, then word prefixes, then substrings.
 * Exact matches rank as prefixes so the catalog order, common faces first, beats rare exact keywords: `10` offers 💯 before 🕙.
 */
export const searchEmojis = (
  index: EmojiSearchIndex,
  query: string,
  limit = Number.POSITIVE_INFINITY,
): string[] => {
  const normalizedQuery = normalizeEmojiSearchText(query);
  if (!normalizedQuery) return [];
  return index
    .map((entry, order) => ({
      emoji: entry.emoji,
      order,
      rank: Math.min(
        ...entry.terms.map((term) => termRank(term, normalizedQuery)),
      ),
    }))
    .filter((match) => Number.isFinite(match.rank))
    .sort((left, right) => left.rank - right.rank || left.order - right.order)
    .slice(0, limit)
    .map((match) => match.emoji);
};

export interface EmojiShortcodeQuery {
  readonly end: number;
  readonly query: string;
  readonly start: number;
}

// Two characters keep `:)` and `:D` out, and the leading space keeps out times like `12:30`.
const SHORTCODE_PATTERN = /(?:^|\s):([\p{L}\p{N}_+-]{2,})$/u;

/** The `:query` the caret ends, as typed before picking an emoji. */
export const getEmojiShortcodeQuery = (
  value: string,
  caret: number,
): EmojiShortcodeQuery | null => {
  const safeCaret = Math.max(0, Math.min(caret, value.length));
  const query = value.slice(0, safeCaret).match(SHORTCODE_PATTERN)?.[1];
  if (query === undefined) return null;
  return { end: safeCaret, query, start: safeCaret - query.length - 1 };
};

export const applyEmojiShortcode = (
  value: string,
  shortcode: EmojiShortcodeQuery,
  emoji: string,
): { caret: number; value: string } => {
  const replacement = `${emoji} `;
  return {
    caret: shortcode.start + replacement.length,
    value: `${value.slice(0, shortcode.start)}${replacement}${value.slice(shortcode.end)}`,
  };
};
