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
          setupFiles: ["./src/testing/jsdomSetup.ts"],
        },
      },
    ],
  },
});
