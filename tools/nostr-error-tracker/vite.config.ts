import { evoluWorkerPolyfills } from "@linky-fit/config/vite";
import react from "@vitejs/plugin-react-swc";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const workerPolyfills = evoluWorkerPolyfills(
  fileURLToPath(new URL("./src/browserPolyfills.ts", import.meta.url)),
);

export default defineConfig({
  plugins: [workerPolyfills, react()],
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "@evolu/common",
    ],
    exclude: ["@evolu/web", "@evolu/sqlite-wasm"],
  },
  worker: { format: "es", plugins: () => [workerPolyfills] },
});
