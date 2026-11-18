import { linkyUi } from "@linky-fit/ui/vite";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";

export default defineConfig({
  define: { global: "globalThis" },
  plugins: [linkyUi(), react()],
  // Evolu starts its workers and loads its wasm from URLs next to its own modules, which prebundling would move.
  optimizeDeps: {
    exclude: ["@evolu/web", "@evolu/sqlite-wasm"],
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
