import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "@evolu/common",
    ],
    exclude: ["@evolu/react-web", "@evolu/web", "@evolu/sqlite-wasm"],
  },
});
