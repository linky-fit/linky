import config from "@linky-fit/config/eslint";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  ...config,
  globalIgnores([".expo", "public"]),
  {
    // Its exports mirror apps/linky-app/src/platform/navigation.ts.
    files: ["src/navigation.tsx"],
    rules: { "react-refresh/only-export-components": "off" },
  },
]);
