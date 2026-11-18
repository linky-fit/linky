import { linkyUi } from "@linky-fit/ui/vite";
import react from "@vitejs/plugin-react-swc";
import { execSync } from "node:child_process";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import packageJson from "./package.json" with { type: "json" };

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

// MONETA's API answers no browser directly (no CORS), so the app calls
// `/api/moneta/*` on its own origin: this proxy in development, `api/moneta.ts` on Vercel.
const monetaProxy = {
  "/api/moneta": {
    target: "https://api.moneta.cz",
    changeOrigin: true,
    rewrite: (path: string) =>
      path.replace(/^\/api\/moneta/u, "/api/v4/vip/aisp/my"),
  },
};

export default defineConfig({
  define: {
    global: "globalThis",
    __APP_VERSION__: JSON.stringify(packageJson.version),
    __APP_COMMIT_SHA__: JSON.stringify(commitSha),
  },
  plugins: [
    linkyUi(),
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
      // Evolu's workers and sqlite3.wasm are precached too, so Evolu opens its database offline.
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,svg,png,webp,woff2,wasm}"],
        rollupFormat: "es",
      },
      manifest: {
        name: "Fazole",
        short_name: "Fazole",
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
  // Evolu starts its workers and loads its wasm from URLs next to its own modules, which prebundling would move.
  optimizeDeps: {
    exclude: ["@evolu/web", "@evolu/sqlite-wasm"],
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
  server: { port: 5280, strictPort: true, proxy: monetaProxy },
  preview: { port: 5280, strictPort: true, proxy: monetaProxy },
});
