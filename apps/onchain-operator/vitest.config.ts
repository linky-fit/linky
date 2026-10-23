import { linkyUi } from "@linky-fit/ui/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [linkyUi()],
  test: {
    setupFiles: "./vitest.setup.ts",
    server: {
      deps: { inline: [/tamagui/, /react-native/, /lucide-react-native/] },
    },
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          include: ["src/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        extends: true,
        test: {
          name: "jsdom",
          include: ["src/**/*.test.tsx"],
          environment: "jsdom",
          // CI runs every workspace's suite at once, which slows jsdom renders past the 5s default.
          testTimeout: 15_000,
        },
      },
    ],
  },
});
