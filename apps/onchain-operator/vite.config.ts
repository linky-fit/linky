import { linkyUi } from "@linky-fit/ui/vite";
import react from "@vitejs/plugin-react-swc";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import type { Plugin } from "vite";
import { defineConfig } from "vite";

const require = createRequire(import.meta.url);
const sqliteWasmPath = path.join(
  path.dirname(require.resolve("@evolu/sqlite-wasm/package.json")),
  "sqlite-wasm/jswasm/sqlite3.wasm",
);

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
  define: { global: "globalThis" },
  plugins: [linkyUi(), serveSqliteWasm(), react()],
  // Evolu's web package starts its database worker from a URL next to its own module, which prebundling would move.
  optimizeDeps: {
    exclude: ["@evolu/web"],
    // Found only once the database worker loads; listed so the dev server does not reload mid-boot.
    include: ["@evolu/common", "@evolu/common/local-first"],
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
  server: { port: 5295, strictPort: true },
  preview: { port: 5295, strictPort: true },
});
