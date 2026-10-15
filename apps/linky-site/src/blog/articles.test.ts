import { expect, test } from "vitest";

const folders = (paths: Record<string, unknown>) =>
  Object.keys(paths)
    .map((path) => path.split("/").at(-2))
    .sort();

test("every article has a page at /blog/<slug>/ and every page an article", () => {
  expect(folders(import.meta.glob("../../blog/*/index.html"))).toEqual(
    folders(import.meta.glob("./articles/*/index.ts")),
  );
});
