import react from "@vitejs/plugin-react-swc";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./vitest.setup.ts",
    css: true,
    // tests/ holds the Playwright suites and their helpers; unit tests sit
    // next to their subject under src/.
    exclude: [...configDefaults.exclude, "tests/**"],
  },
});
