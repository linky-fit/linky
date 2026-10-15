import type { ComponentType } from "react";
import type { SiteLocale } from "../sitePreferences";

/** English is required; the other site languages fall back to it. */
export type Localized<T> = { en: T } & Partial<Record<SiteLocale, T>>;

export interface Author {
  name: string;
  avatar: string;
  bio: Localized<string>;
  nostr?: string;
  /** The X handle without the `@`. */
  x?: string;
  /** The id in the author's Linky profile link, linky.fit/p/<id>: a Linky name or an npub. */
  linky?: string;
}

export interface ArticleTranslation {
  title: string;
  /** The lead under the title, also the teaser in the article list. */
  description: string;
  coverAlt: string;
  Body: ComponentType;
}

/** At least one language; readers of the others get English, or the first language the article has. */
export type ArticleTranslations = Partial<
  Record<SiteLocale, ArticleTranslation>
>;

export interface Article {
  /** The ISO date of the first publication. */
  publishedOn: string;
  author: Author;
  cover: string;
  translations: ArticleTranslations;
}

/** The order in which a reader without the article's language is served: English first. */
const fallbackLanguages: SiteLocale[] = ["en", "cs", "de"];

const pickTranslation = (
  translations: ArticleTranslations,
  locale: SiteLocale,
): { language: SiteLocale; translation: ArticleTranslation } => {
  for (const language of [locale, ...fallbackLanguages]) {
    const translation = translations[language];
    if (translation) return { language, translation };
  }
  throw new Error("An article needs at least one translation");
};

/** The article in the reader's language when it has one, in English or its only language otherwise. */
export const translateArticle = (article: Article, locale: SiteLocale) => {
  const { language, translation } = pickTranslation(
    article.translations,
    locale,
  );
  return {
    ...translation,
    language,
    bio: article.author.bio[language] ?? article.author.bio.en,
    publishedOn: new Intl.DateTimeFormat(language, {
      dateStyle: "long",
      timeZone: "UTC",
    }).format(new Date(article.publishedOn)),
  };
};

/** The slug in an article URL, `/blog/<slug>/`, with or without the trailing slash. */
export const articleSlug = (path: string) =>
  /^\/blog\/([^/]+)\/?$/u.exec(path)?.[1];
