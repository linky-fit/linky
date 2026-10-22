import eslintConfig, {
  platformSeamPlugin,
  platformSeamRules,
  pureJsPbkdf2ImportPatterns,
  restrictedSyntax,
  testHelperImportIgnores,
  testHelperImportPatterns,
  uiOnlyPlugin,
} from "@linky-fit/config/eslint";
import { defineConfig } from "eslint/config";

const evoluImportPatterns = [
  {
    group: ["@evolu/*"],
    message:
      "Read and write through the @linky-fit/linksync repositories; only src/storage/evolu.web.ts and src/evoluDb.worker.ts import @evolu/* directly.",
  },
];
const envMessage = "Read build-time env from src/config.ts.";
const envSyntax = [
  {
    selector:
      "MemberExpression[object.type='MetaProperty'][property.name='env']",
    message: envMessage,
  },
];

export default defineConfig([
  ...eslintConfig,
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: testHelperImportIgnores,
    rules: {
      "@typescript-eslint/consistent-type-definitions": ["error", "interface"],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...testHelperImportPatterns,
            ...evoluImportPatterns,
            ...pureJsPbkdf2ImportPatterns,
          ],
        },
      ],
      "no-restricted-syntax": ["error", ...restrictedSyntax, ...envSyntax],
    },
  },
  {
    files: ["src/config.ts"],
    rules: { "no-restricted-syntax": ["error", ...restrictedSyntax] },
  },
  {
    files: ["src/storage/evolu.web.ts", "src/evoluDb.worker.ts"],
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
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      ...testHelperImportIgnores,
      "src/platform/**",
      "src/**/*.web.{ts,tsx}",
      "src/main.tsx",
      "src/evoluDb.worker.ts",
    ],
    plugins: { "platform-seam": platformSeamPlugin },
    rules: platformSeamRules(
      "Browser APIs go behind src/platform (or a .web.ts sibling).",
    ),
  },
  {
    files: ["src/**/*.tsx"],
    ignores: testHelperImportIgnores,
    plugins: { "linky-ui": uiOnlyPlugin },
    rules: { "linky-ui/ui-only": "error" },
  },
]);
