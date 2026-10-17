// Builds /sw.js from apps/linky-app/src/sw.ts over the export, as
// vite-plugin-pwa's injectManifest does for the Vite build.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { injectManifest } from "workbox-build";
import { bundleWithBun } from "./bundleWithBun.ts";

export const buildServiceWorker = async (dist: string): Promise<void> => {
  const outdir = await mkdtemp(join(tmpdir(), "linky-sw-"));
  try {
    const swSrc = await bundleWithBun("src/sw.ts", {
      outdir,
      naming: "sw.js",
      // Registered as a classic script, like the Vite build's /sw.js.
      format: "iife",
    });
    const { count, size, warnings } = await injectManifest({
      swSrc,
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
