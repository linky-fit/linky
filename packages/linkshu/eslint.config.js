import {
  platformIndependentEslintConfig,
  platformIndependentImportPatterns,
  restrictedSyntax,
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
              group: [
                "@linky-fit/linkstr",
                "@linky-fit/linkstr/*",
                "@linky-fit/linkstr-react*",
              ],
              message: "linkshu and linkstr stay independent of each other.",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        ...restrictedSyntax,
        {
          selector:
            "CallExpression[callee.property.name='emit'] > ArrowFunctionExpression > NewExpression:not(:has(ObjectExpression.arguments:nth-child(2) > Property[key.name='disableChecks'][value.value=true]))",
          message:
            "Build inspector events with `{ disableChecks: true }` so an off-brand field still reaches the feed.",
        },
      ],
    },
  },
]);
