import coreEslintConfig, {
  restrictedSyntax,
  testHelperImportIgnores,
  testHelperImportPatterns,
} from "@linky-fit/config/eslint";
import { defineConfig } from "eslint/config";

const linkstrRestrictedSyntax = [
  ...restrictedSyntax,
  {
    selector:
      ":matches(CallExpression[callee.property.name='emit'] > ArrowFunctionExpression, CallExpression[callee.property.name='emit'] > ArrowFunctionExpression > ConditionalExpression) > NewExpression:not(:has(ObjectExpression.arguments:nth-child(2) > Property[key.name='disableChecks'][value.value=true]))",
    message:
      "Build inspector events with `{ disableChecks: true }` so an off-brand field still reaches the feed.",
  },
];

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
            {
              group: ["@linky-fit/linkshu", "@linky-fit/linkshu/*"],
              message: "linkshu and linkstr stay independent of each other.",
            },
          ],
        },
      ],
      "no-restricted-syntax": ["error", ...linkstrRestrictedSyntax],
    },
  },
  {
    files: ["src/*/codec.ts"],
    ignores: testHelperImportIgnores,
    rules: {
      "no-restricted-syntax": [
        "error",
        ...linkstrRestrictedSyntax,
        {
          selector:
            "CallExpression[callee.property.name=/^(find|filter)$/]:matches([callee.object.property.name='tags'], [callee.object.name='tags'])",
          message:
            "Read tags with the helpers in internal/nostrEvent.ts (firstTagValue, tagValues, tagsNamed).",
        },
      ],
    },
  },
]);
