import basicSsl from "@vitejs/plugin-basic-ssl";
import react from "@vitejs/plugin-react-swc";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import type { ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Connect, Plugin, ViteDevServer } from "vite";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import lnurlpHandler from "./api/lnurlp.js";
import { inspectorCollector } from "./server/inspectorCollector";
import { fetchLinkPreview } from "./server/linkPreview";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sqliteWasmPath = path.join(__dirname, "public/sqlite-wasm/sqlite3.wasm");
const workspacePackageJsonPath = path.join(
  __dirname,
  "..",
  "..",
  "package.json",
);

const isUnknownRecord = (value: unknown): value is Record<string, unknown> => {
  return value !== null && typeof value === "object";
};

const appVersion = (() => {
  try {
    const raw = readFileSync(workspacePackageJsonPath, "utf8");
    const pkg = JSON.parse(raw);
    if (!isUnknownRecord(pkg)) return "0.0.0";
    const version = pkg.version;
    return typeof version === "string" && version.trim()
      ? version.trim()
      : "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

const normalizeShortCommitSha = (value: string | undefined): string => {
  const trimmed = String(value ?? "").trim();
  return /^[0-9a-f]{7,40}$/i.test(trimmed) ? trimmed.slice(0, 7) : "";
};

const appCommitSha = (() => {
  const envSha = normalizeShortCommitSha(
    process.env.VERCEL_GIT_COMMIT_SHA ??
      process.env.VITE_VERCEL_GIT_COMMIT_SHA ??
      process.env.GIT_COMMIT_SHA,
  );
  if (envSha) return envSha;

  try {
    return normalizeShortCommitSha(
      execSync("git rev-parse --short=7 HEAD", {
        cwd: __dirname,
        stdio: ["ignore", "pipe", "ignore"],
      }).toString("utf8"),
    );
  } catch {
    return "";
  }
})();

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
    server.middlewares.use(
      async (
        req: Connect.IncomingMessage,
        res: ServerResponse,
        next: Connect.NextFunction,
      ) => {
        const url = new URL(req.url ?? "", "http://localhost");
        if (url.pathname !== "/api/lnurlp") return next();
        await lnurlpHandler(
          {
            method: req.method ?? "",
            headers: req.headers,
            query: Object.fromEntries(url.searchParams),
          },
          {
            setHeader: (name, value) => {
              res.setHeader(name, value);
            },
            status: (code) => {
              res.statusCode = code;
              return {
                json: (body) => {
                  res.end(JSON.stringify(body));
                },
                send: (body) => {
                  res.end(body);
                },
              };
            },
          },
        );
      },
    );
  },
});

const linkPreviewApi = (): Plugin => ({
  name: "link-preview-api",
  configureServer(server: ViteDevServer) {
    server.middlewares.use(
      async (
        req: Connect.IncomingMessage,
        res: ServerResponse,
        next: Connect.NextFunction,
      ) => {
        const requestUrl = req.url ?? "";
        if (!requestUrl.startsWith("/api/link-preview")) return next();

        if (req.method !== "GET") {
          res.statusCode = 405;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Method not allowed" }));
          return;
        }

        try {
          const parsed = new URL(requestUrl, "http://localhost");
          const target = String(parsed.searchParams.get("url") ?? "").trim();
          const preview = await fetchLinkPreview(target);
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Cache-Control", "no-store");
          res.end(JSON.stringify(preview));
        } catch (error) {
          server.config.logger.warn(
            `Link preview error: ${String(error ?? "unknown")}`,
          );
          res.statusCode = 422;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Preview unavailable" }));
        }
      },
    );
  },
});

export default defineConfig({
  define: {
    global: "globalThis",
    __APP_VERSION__: JSON.stringify(appVersion),
    __APP_COMMIT_SHA__: JSON.stringify(appCommitSha),
  },
  optimizeDeps: {
    exclude: ["@evolu/react-web"],
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
      "@scure/bip39/wordlists/english",
      "buffer",
      "cbor-x",
      "effect",
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
      registerType: "prompt",
      srcDir: "src",
      strategies: "injectManifest",
      injectManifest: {
        rollupFormat: "es",
        // pdf.js is loaded on demand for PDF previews; don't precache it.
        globIgnores: ["**/pdf.worker*", "**/pdfjs-*"],
      },
      manifest: {
        name: "Linky",
        short_name: "Linky",
        id: "/",
        scope: "/",
        start_url: "/",
        display: "standalone",
        orientation: "portrait-primary",
        protocol_handlers: [
          {
            protocol: "web+cashu",
            url: "/#wallet?cashu=%s",
          },
        ],
        related_applications: [
          {
            platform: "webapp",
            url: "/manifest.webmanifest",
            id: "/",
          },
        ],
        background_color: "#ffffff",
        theme_color: "#14b8a6",
        icons: [
          {
            src: "/icon.svg",
            sizes: "any",
            type: "image/svg+xml",
          },
          {
            src: "/pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
        ],
      },
    }),
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
          if (
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
