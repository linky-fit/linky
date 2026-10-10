import {
  platformIndependentEslintConfig,
  platformIndependentImportPatterns,
  testHelperImportIgnores,
  testHelperImportPatterns,
} from "@linky-fit/config/eslint";
import { defineConfig } from "eslint/config";

export default defineConfig([
  ...platformIndependentEslintConfig,
  {
    files: ["src/**/*.ts"],
    ignores: testHelperImportIgnores,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...testHelperImportPatterns,
            ...platformIndependentImportPatterns,
            {
              group: ["node:*"],
              message:
                "linkauth runs in browsers and edge runtimes: no Node built-ins.",
            },
            {
              group: ["effect", "@linky-fit/linkstr", "@linky-fit/linkstr/*"],
              message:
                "linkauth has no Effect and stays independent of linkstr.",
            },
          ],
        },
      ],
    },
  },
]);
