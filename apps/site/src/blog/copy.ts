import type { SiteLocale } from "../sitePreferences";

interface BlogCopy {
  title: string;
  description: string;
  allArticlesLabel: string;
  writtenByLabel: string;
}

export const copy: Record<SiteLocale, BlogCopy> = {
  cs: {
    title: "Blog",
    description: "Příběhy a nápady lidí, kteří stojí za Linky.",
    allArticlesLabel: "Všechny články",
    writtenByLabel: "Autor",
  },
  en: {
    title: "Blog",
    description: "Stories and ideas from the people behind Linky.",
    allArticlesLabel: "All articles",
    writtenByLabel: "Written by",
  },
  de: {
    title: "Blog",
    description: "Geschichten und Ideen der Menschen hinter Linky.",
    allArticlesLabel: "Alle Artikel",
    writtenByLabel: "Geschrieben von",
  },
};
