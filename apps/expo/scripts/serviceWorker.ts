// Builds /sw.js from apps/linky-app/src/sw.ts over the export, as
// vite-plugin-pwa's injectManifest does for the Vite build.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { injectManifest } from "workbox-build";
import {
  appCommitSha,
  appVersion,
} from "@linky-fit/linky-app/server/buildInfo.ts";

const webApp = dirname(
  Bun.resolveSync("@linky-fit/linky-app/package.json", import.meta.dir),
);
const viteBuildEnv = join(webApp, "src/platform/buildEnv.ts");
const expoBuildEnv = join(import.meta.dir, "../src/buildEnv.ts");

export const buildServiceWorker = async (dist: string): Promise<void> => {
  const outdir = await mkdtemp(join(tmpdir(), "linky-sw-"));
  try {
    const built = await Bun.build({
      entrypoints: [join(webApp, "src/sw.ts")],
      outdir,
      naming: "sw.js",
      // Registered as a classic script, like the Vite build's /sw.js.
      format: "iife",
      target: "browser",
      minify: true,
      // Inlines EXPO_PUBLIC_* as Expo does; unset ones read as undefined.
      env: "EXPO_PUBLIC_*",
      define: {
        "process.env": "{}",
        "process.env.NODE_ENV": '"production"',
        __DEV__: "false",
        __APP_VERSION__: JSON.stringify(appVersion),
        __APP_COMMIT_SHA__: JSON.stringify(appCommitSha),
      },
      plugins: [
        {
          name: "expo-build-env",
          setup(build) {
            build.onResolve({ filter: /\/buildEnv$/ }, ({ path, importer }) =>
              resolve(dirname(importer), `${path}.ts`) === viteBuildEnv
                ? { path: expoBuildEnv }
                : undefined,
            );
          },
        },
      ],
    });
    if (!built.success)
      throw new AggregateError(built.logs, "sw.ts build failed");

    const { count, size, warnings } = await injectManifest({
      swSrc: join(outdir, "sw.js"),
      swDest: join(dist, "sw.js"),
      globDirectory: dist,
      globPatterns: ["**/*.{js,wasm,css,html,woff2}"],
      // pdf.js loads on demand for PDF previews, as in vite.config.ts.
      globIgnores: ["sw.js", "vendor/**", "**/pdf-*"],
      // Metro's shared chunk is over Workbox's 2 MB default.
      maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      dontCacheBustURLsMatching: /^_expo\/static\//,
    });
    for (const warning of warnings) console.warn(warning);
    console.log(
      `sw.js precaches ${count} files, ${(size / 1024 / 1024).toFixed(1)} MiB`,
    );
  } finally {
    await rm(outdir, { recursive: true, force: true });
  }
};
