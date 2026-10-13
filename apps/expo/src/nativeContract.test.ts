import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const expoRoot = path.join(import.meta.dir, "..");
const webAppSrc = path.join(expoRoot, "../linky-app/src");
const contractFile = path.join(import.meta.dir, "native.contract.ts");
const webAppPrefix = "@linky-fit/linky-app/src/";

const listFiles = (root: string, pattern: string): string[] =>
  Array.from(new Bun.Glob(pattern).scanSync({ cwd: root, absolute: true }));

const nativeFiles = [
  ...listFiles(webAppSrc, "**/*.native.{ts,tsx}"),
  ...listFiles(import.meta.dir, "**/*.native.{ts,tsx}"),
];

const sourceFiles = [
  ...listFiles(webAppSrc, "**/*.{ts,tsx}"),
  ...listFiles(path.join(expoRoot, "src"), "**/*.{ts,tsx}"),
  ...listFiles(path.join(expoRoot, "app"), "**/*.{ts,tsx}"),
  path.join(expoRoot, "index.ts"),
];

const stripExtension = (file: string): string =>
  file.replace(/\.(ts|tsx)$/, "");

const hasFile = (modulePath: string): boolean =>
  existsSync(`${modulePath}.ts`) || existsSync(`${modulePath}.tsx`);

/** Absolute path of a local import specifier, or null for a package import. */
const resolveSpecifier = (fromFile: string, specifier: string) => {
  if (specifier.startsWith(".")) {
    return path.resolve(path.dirname(fromFile), specifier);
  }
  if (specifier.startsWith(webAppPrefix)) {
    return path.join(webAppSrc, specifier.slice(webAppPrefix.length));
  }
  return null;
};

const importSpecifiers = (file: string): string[] =>
  Array.from(
    readFileSync(file, "utf8").matchAll(
      /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["']([^"']+)["']/g,
    ),
    (match) => match[1] ?? "",
  );

/** `foo.native.ts` modules whose web sibling `foo.ts(x)` exists. */
const seamPairs = nativeFiles
  .map((file) => stripExtension(file))
  .filter((nativeModule) => hasFile(nativeModule.replace(/\.native$/, "")));

const seamBases = new Set(
  seamPairs.map((nativeModule) => nativeModule.replace(/\.native$/, "")),
);

describe("native.contract.ts", () => {
  it("pairs every .native module with its web sibling", () => {
    const covered = new Set(
      importSpecifiers(contractFile).flatMap((specifier) => {
        const resolved = resolveSpecifier(contractFile, specifier);
        return resolved === null ? [] : [stripExtension(resolved)];
      }),
    );
    const missing = seamPairs
      .flatMap((nativeModule) => [
        nativeModule,
        nativeModule.replace(/\.native$/, ""),
      ])
      .filter((modulePath) => !covered.has(modulePath))
      .map((modulePath) => path.relative(expoRoot, modulePath));
    expect(missing).toEqual([]);
  });

  it("finds no import naming a seam's web module with its extension", () => {
    // Metro resolves "./foo.ts" to that file on native too, skipping foo.native.ts.
    const explicit = sourceFiles.flatMap((file) =>
      importSpecifiers(file)
        .filter((specifier) => /\.tsx?$/.test(specifier))
        .filter((specifier) => {
          const resolved = resolveSpecifier(file, specifier);
          return resolved !== null && seamBases.has(stripExtension(resolved));
        })
        .map((specifier) => `${path.relative(expoRoot, file)}: ${specifier}`),
    );
    expect(explicit).toEqual([]);
  });
});
