import { cp, writeFile } from "node:fs/promises";

interface SourceManifest {
  name: string;
  version: string;
  description: string;
  license: string;
  type: string;
  repository: { type: string; url: string; directory: string };
  homepage: string;
  bugs: { url: string };
  engines: { node: string };
  exports: Record<string, string>;
  dependencies: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional: boolean }>;
}

export async function prepareNpmPackage(source: SourceManifest) {
  const exports = Object.fromEntries(
    Object.entries(source.exports).map(([key, path]) => {
      const output = path.replace(/^\.\/src\//, "./").replace(/\.ts$/, "");
      return [key, { types: `${output}.d.ts`, import: `${output}.js` }];
    }),
  );
  for (const version of Object.values(source.dependencies)) {
    if (version.startsWith("workspace:")) {
      throw new Error("Published dependencies must exist on npm");
    }
  }
  const manifest = {
    name: source.name,
    version: source.version,
    description: source.description,
    license: source.license,
    type: source.type,
    repository: source.repository,
    homepage: source.homepage,
    bugs: source.bugs,
    engines: source.engines,
    main: "./index.js",
    types: "./index.d.ts",
    exports,
    files: ["**/*.js", "**/*.d.ts", "README.md", "LICENSE", "docs"],
    dependencies: source.dependencies,
    peerDependencies: source.peerDependencies,
    peerDependenciesMeta: source.peerDependenciesMeta,
    publishConfig: { access: "public", registry: "https://registry.npmjs.org" },
  };
  await Promise.all([
    writeFile("dist/package.json", `${JSON.stringify(manifest, null, 2)}\n`),
    cp("README.md", "dist/README.md"),
    cp("../../LICENSE", "dist/LICENSE"),
    cp("docs", "dist/docs", { recursive: true }),
  ]);
}
