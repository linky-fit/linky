import { describe, expect, it } from "vitest";
import { absolutePreviewImages, deploymentOrigin } from "./previewImages";

describe("deploymentOrigin", () => {
  it("uses the branch URL on Vercel previews", () => {
    expect(
      deploymentOrigin({
        VERCEL_ENV: "preview",
        VERCEL_BRANCH_URL: "site-git-blog.vercel.app",
        VERCEL_PROJECT_PRODUCTION_URL: "linky.fit",
      }),
    ).toBe("https://site-git-blog.vercel.app");
  });

  it("uses the production domain on production deployments", () => {
    expect(
      deploymentOrigin({
        VERCEL_ENV: "production",
        VERCEL_BRANCH_URL: "site-git-main.vercel.app",
        VERCEL_PROJECT_PRODUCTION_URL: "other.example",
      }),
    ).toBe("https://other.example");
  });

  it("falls back to linky.fit outside Vercel", () => {
    expect(deploymentOrigin({})).toBe("https://linky.fit");
  });
});

describe("absolutePreviewImages", () => {
  it("prefixes og:image paths with the origin, across a line break", () => {
    expect(
      absolutePreviewImages(
        '<meta\n  property="og:image"\n  content="/blog/a/cover.jpg"\n/>',
        "https://linky.fit",
      ),
    ).toBe(
      '<meta\n  property="og:image"\n  content="https://linky.fit/blog/a/cover.jpg"\n/>',
    );
  });

  it("leaves absolute image URLs and other meta tags alone", () => {
    const html =
      '<meta property="og:image" content="https://cdn.example/a.jpg" /><meta property="og:url" content="/blog/" />';
    expect(absolutePreviewImages(html, "https://linky.fit")).toBe(html);
  });
});
