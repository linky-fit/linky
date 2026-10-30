import { linkyUi } from "@linky-fit/ui/vite";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [linkyUi(), react()],
  test: {
    globals: true,
    // Node cannot load React Native sources; inlining sends them through the react-native-web aliases.
    server: {
      deps: { inline: [/tamagui/, /react-native/, /lucide-react-native/] },
    },
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          include: ["src/**/*.test.ts", "api/**/*.test.ts"],
          environment: "node",
          setupFiles: ["./src/testing/czechDevice.ts"],
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
          setupFiles: [
            "./src/testing/czechDevice.ts",
            "./src/testing/jsdomSetup.ts",
          ],
        },
      },
    ],
  },
});
