import { describe, expect, it } from "vitest";
import { articleSlug, translateArticle, type Article } from "./article";

const Body = () => null;

const article: Article = {
  publishedOn: "2026-10-01",
  author: {
    name: "Ada",
    avatar: "/ada.jpg",
    bio: { en: "English bio", cs: "Český životopis" },
  },
  cover: "/cover.jpg",
  translations: {
    en: { title: "English", description: "", coverAlt: "", Body },
    cs: { title: "Česky", description: "", coverAlt: "", Body },
  },
};

describe("translateArticle", () => {
  it("uses the reader's language when the article has it", () => {
    const { language, title, bio } = translateArticle(article, "cs");
    expect({ language, title, bio }).toEqual({
      language: "cs",
      title: "Česky",
      bio: "Český životopis",
    });
  });

  it("falls back to English, bio included, when the article lacks the language", () => {
    const { language, title, bio } = translateArticle(article, "de");
    expect({ language, title, bio }).toEqual({
      language: "en",
      title: "English",
      bio: "English bio",
    });
  });

  it("keeps the English bio when the author has none in the article's language", () => {
    const englishBioOnly = {
      ...article,
      author: { ...article.author, bio: { en: "English bio" } },
    };
    expect(translateArticle(englishBioOnly, "cs").bio).toBe("English bio");
  });

  it("formats the publication date in UTC, in the article's language", () => {
    expect(translateArticle(article, "en").publishedOn).toBe("October 1, 2026");
    expect(translateArticle(article, "cs").publishedOn).toBe("1. října 2026");
  });
});

describe("articleSlug", () => {
  it("reads the slug with or without the trailing slash", () => {
    expect(articleSlug("/blog/hello/")).toBe("hello");
    expect(articleSlug("/blog/hello")).toBe("hello");
  });

  it("finds no slug outside an article URL", () => {
    expect(articleSlug("/blog/")).toBeUndefined();
    expect(articleSlug("/blog/hello/extra/")).toBeUndefined();
  });
});
