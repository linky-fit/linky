import { linkyUi } from "@linky-fit/ui/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [linkyUi()],
  test: {
    environment: "node",
    include: [
      "api/**/*.test.ts",
      "build/**/*.test.ts",
      "src/**/*.test.{ts,tsx}",
    ],
    server: {
      deps: { inline: [/react-native/, /lucide-react-native/] },
    },
  },
});
