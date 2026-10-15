import { linkyUi } from "@linky-fit/ui/vite";
import react from "@vitejs/plugin-react-swc";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [linkyUi(), react()],
  test: {
    globals: true,
    setupFiles: "./vitest.setup.ts",
    css: true,
    // Node cannot load React Native sources; inlining sends them through the react-native-web aliases.
    server: {
      deps: { inline: [/tamagui/, /react-native/, /lucide-react-native/] },
    },
    // tests/ holds the Playwright suites and their helpers; unit tests sit
    // next to their subject under src/.
    exclude: [...configDefaults.exclude, "tests/**"],
    // jsdom setup costs more than most DOM-free files take to run; a .test.ts
    // that needs the DOM opts in with a `// @vitest-environment jsdom` docblock.
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          include: ["**/*.test.{ts,js}"],
          environment: "node",
        },
      },
      {
        extends: true,
        test: {
          name: "jsdom",
          include: ["**/*.test.tsx"],
          environment: "jsdom",
        },
      },
    ],
  },
});
