import type { Article } from "./article";

const modules = import.meta.glob<{ article: Article }>(
  "./articles/*/index.ts",
  {
    eager: true,
  },
);

/** Every article, newest first; the slug is the name of its folder in `articles/`. */
export const articles = Object.entries(modules)
  .map(([path, { article }]) => ({
    ...article,
    slug: path.split("/")[2] ?? "",
  }))
  .sort((a, b) => b.publishedOn.localeCompare(a.publishedOn));

export const articleHref = (slug: string) => `/blog/${slug}/`;
