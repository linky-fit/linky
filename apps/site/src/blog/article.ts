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
}

export interface ArticleTranslation {
  title: string;
  /** The lead under the title, also the teaser in the article list. */
  description: string;
  coverAlt: string;
  Body: ComponentType;
}

export interface Article {
  /** The ISO date of the first publication. */
  publishedOn: string;
  author: Author;
  cover: string;
  translations: Localized<ArticleTranslation>;
}

/** The article in the reader's language when it has one, in English otherwise. */
export const translateArticle = (article: Article, locale: SiteLocale) => {
  const language = article.translations[locale] ? locale : "en";
  return {
    ...(article.translations[language] ?? article.translations.en),
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
