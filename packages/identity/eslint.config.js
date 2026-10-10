import coreEslintConfig, {
  pureJsPbkdf2ImportPatterns,
  testHelperImportIgnores,
  testHelperImportPatterns,
} from "@linky-fit/config/eslint";
import { defineConfig } from "eslint/config";

export default defineConfig([
  ...coreEslintConfig,
  {
    files: ["src/**/*.ts"],
    ignores: testHelperImportIgnores,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...testHelperImportPatterns,
            ...pureJsPbkdf2ImportPatterns,
          ],
        },
      ],
    },
  },
]);
