import { linkyUi } from "@linky-fit/ui/vite";
import react from "@vitejs/plugin-react-swc";
import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import type { Plugin } from "vite";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import packageJson from "./package.json" with { type: "json" };

const require = createRequire(import.meta.url);
const sqliteWasmPath = path.join(
  path.dirname(require.resolve("@evolu/sqlite-wasm/package.json")),
  "sqlite-wasm/jswasm/sqlite3.wasm",
);

const shortCommitSha = (value: string | undefined) => {
  const sha = (value ?? "").trim();
  return /^[0-9a-f]{7,40}$/i.test(sha) ? sha.slice(0, 7) : "";
};

const commitSha = (() => {
  const fromEnv = shortCommitSha(
    process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA,
  );
  if (fromEnv) return fromEnv;
  try {
    return shortCommitSha(
      execSync("git rev-parse --short=7 HEAD", {
        cwd: import.meta.dirname,
        stdio: ["ignore", "pipe", "ignore"],
      }).toString(),
    );
  } catch {
    return "";
  }
})();

// Evolu's worker fetches sqlite3.wasm next to its module; the dev server must answer with the wasm MIME type.
const serveSqliteWasm = (): Plugin => ({
  name: "serve-sqlite-wasm",
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (!(req.url ?? "").includes("sqlite3.wasm")) return next();
      try {
        const wasm = await fs.readFile(sqliteWasmPath);
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/wasm");
        res.setHeader("Cache-Control", "no-store");
        res.end(wasm);
      } catch (error) {
        server.config.logger.error(
          `Failed to serve sqlite3.wasm: ${String(error)}`,
        );
        next();
      }
    });
  },
});

export default defineConfig({
  define: {
    global: "globalThis",
    __APP_VERSION__: JSON.stringify(packageJson.version),
    __APP_COMMIT_SHA__: JSON.stringify(commitSha),
  },
  plugins: [
    linkyUi(),
    serveSqliteWasm(),
    react(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "prompt",
      injectRegister: false,
      devOptions: { enabled: true, type: "module" },
      // Icons, favicon and apple-touch-icon are generated from public/logo.webp (pwa-assets.config.ts).
      pwaAssets: { config: true, injectThemeColor: false },
      // sqlite3.wasm is precached too, so Evolu opens its database offline.
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,svg,png,webp,woff2,wasm}"],
        // Evolu's own database worker never starts (src/evoluDb.worker.ts replaces it).
        globIgnores: ["**/Db.worker*"],
        rollupFormat: "es",
      },
      manifest: {
        name: "fazole.fit",
        short_name: "fazole.fit",
        description: "Platební terminál pro české obchodníky",
        lang: "cs",
        id: "/",
        scope: "/",
        start_url: "/",
        display: "standalone",
        orientation: "portrait-primary",
        background_color: "#0a0908",
        theme_color: "#0a0908",
      },
    }),
  ],
  // Evolu's web package starts its database worker from a URL next to its own module, which prebundling would move.
  optimizeDeps: {
    exclude: ["@evolu/web"],
    // Found only once the database worker or the service worker loads; listed so the dev server does not reload mid-boot.
    include: [
      "@evolu/common",
      "@evolu/common/local-first",
      "workbox-precaching",
      "workbox-routing",
      "workbox-window",
    ],
  },
  worker: { format: "es" },
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (!id.includes("node_modules")) return;
          // core-js must load before vendor: Evolu calls `Set.prototype.difference` at module init.
          return id.includes("/node_modules/core-js/") ? "polyfills" : "vendor";
        },
      },
    },
  },
  server: { port: 5280, strictPort: true },
  preview: { port: 5280, strictPort: true },
});
