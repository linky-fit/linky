import { linkyUi } from "@linky-fit/ui/vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import react from "@vitejs/plugin-react-swc";
import fs from "node:fs/promises";
import type { ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Connect, Plugin, ViteDevServer } from "vite";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { contentSecurityPolicyMeta } from "./server/contentSecurityPolicy";
import { appCommitSha, appVersion } from "./server/buildInfo";
import { bootDiagnosticRedaction } from "./server/bootDiagnosticRedaction";
import { linkPreviewMiddleware, lnurlpMiddleware } from "./server/devApi";
import { inspectorCollector } from "./server/inspectorCollector";
import { webManifest } from "./server/webManifest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sqliteWasmPath = path.join(__dirname, "public/sqlite-wasm/sqlite3.wasm");
const useHttps = process.env.VITE_HTTPS === "1";

const serveSqliteWasm = (): Plugin => ({
  name: "serve-sqlite-wasm",
  configureServer(server: ViteDevServer) {
    server.middlewares.use(
      async (
        req: Connect.IncomingMessage,
        res: ServerResponse,
        next: Connect.NextFunction,
      ) => {
        const url = req.url ?? "";
        if (!url.includes("sqlite3.wasm")) return next();

        try {
          const wasm = await fs.readFile(sqliteWasmPath);
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/wasm");
          res.setHeader("Cache-Control", "no-store");
          res.end(wasm);
        } catch (error) {
          server.config.logger.error(
            `Failed to serve sqlite3.wasm from ${sqliteWasmPath}: ${String(
              error,
            )}`,
          );
          next();
        }
      },
    );
  },
});

const lnurlProxy = (): Plugin => ({
  name: "lnurl-proxy",
  configureServer(server: ViteDevServer) {
    server.middlewares.use(lnurlpMiddleware);
  },
});

const linkPreviewApi = (): Plugin => ({
  name: "link-preview-api",
  configureServer(server: ViteDevServer) {
    server.middlewares.use(linkPreviewMiddleware(server.config.logger));
  },
});

export default defineConfig({
  define: {
    global: "globalThis",
    __APP_VERSION__: JSON.stringify(appVersion),
    __APP_COMMIT_SHA__: JSON.stringify(appCommitSha),
  },
  optimizeDeps: {
    exclude: ["@evolu/web"],
    // App is intentionally imported lazily from main.tsx so boot diagnostics
    // can catch module-load failures. Vite's dep scanner does not eagerly walk
    // that dynamic import, so include app/runtime deps here to avoid mid-boot
    // re-optimization and 504 "Outdated Optimize Dep" responses.
    include: [
      "@capacitor/clipboard",
      "@capacitor/core",
      "@capacitor/push-notifications",
      "@capacitor/share",
      "@evolu/common",
      "@evolu/react",
      "@noble/hashes/hmac.js",
      "@noble/hashes/sha2.js",
      "@scure/base",
      "@scure/bip32",
      "@scure/bip39",
      "@scure/bip39/wordlists/english.js",
      "buffer",
      "cbor-x",
      "effect",
      "effect/reactivity",
      "jsqr",
      "nostr-tools",
      "nostr-tools/nip17",
      "nostr-tools/nip44",
      "nostr-tools/nip59",
      "qrcode",
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "slip39-ts",
      "workbox-precaching",
      "workbox-routing",
      "workbox-strategies",
      "workbox-window",
    ],
  },
  resolve: {
    alias: {
      "sqlite-wasm/jswasm/sqlite3.wasm": "/sqlite-wasm/sqlite3.wasm",
    },
  },
  plugins: [
    linkyUi(),
    bootDiagnosticRedaction(),
    serveSqliteWasm(),
    inspectorCollector(),
    linkPreviewApi(),
    lnurlProxy(),
    ...(useHttps ? [basicSsl()] : []),
    react(),
    VitePWA({
      devOptions: {
        enabled: true,
        navigateFallback: "index.html",
        type: "module",
      },
      filename: "sw.ts",
      // main.tsx registers the worker through platform/serviceWorker.ts.
      injectRegister: false,
      registerType: "prompt",
      srcDir: "src",
      strategies: "injectManifest",
      injectManifest: {
        globPatterns: ["**/*.{js,wasm,css,html,woff2}"],
        rollupFormat: "es",
        // pdf.js is loaded on demand for PDF previews, and Evolu's own
        // database worker never starts (src/evoluDb.worker.ts replaces it).
        globIgnores: ["**/pdf.worker*", "**/pdfjs-*", "**/Db.worker*"],
      },
      manifest: webManifest,
    }),
    contentSecurityPolicyMeta(),
  ],
  ...(useHttps ? { server: { host: true, https: {} } } : {}),
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("nostr-tools")) return "nostr";
          if (id.includes("pdfjs-dist")) return "pdfjs";
          // Keep `buffer` and its deps together to avoid an ESM circular init:
          // polyfills -> vendor (base64-js/ieee754) and vendor -> polyfills.
          // core-js must load before vendor: Evolu calls
          // `Set.prototype.difference` at module init.
          if (
            id.includes("/node_modules/core-js/") ||
            id.includes("/node_modules/buffer/") ||
            id.includes("/node_modules/base64-js/") ||
            id.includes("/node_modules/ieee754/")
          ) {
            return "polyfills";
          }
          return "vendor";
        },
      },
    },
  },
});
