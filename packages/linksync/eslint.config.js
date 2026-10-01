import coreEslintConfig, {
  restrictedSyntax,
  testHelperImportPatterns,
  testHelperImportIgnores,
} from "@linky-fit/config/eslint";
import { defineConfig } from "eslint/config";

const runtimeMessage =
  "The Evolu runtime is called only in src/evolu/evoluShardDb.ts; everything else goes through the ShardDb port.";

export default defineConfig([
  ...coreEslintConfig,
  {
    files: ["src/**/*.ts"],
    ignores: ["src/evolu/evoluShardDb.ts", ...testHelperImportIgnores],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...testHelperImportPatterns,
            {
              group: ["@evolu/*", "!@evolu/common"],
              message: runtimeMessage,
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        ...restrictedSyntax,
        {
          selector:
            "MemberExpression[property.name=/^(createQuery|loadQuery|upsert|subscribeQuery)$/]",
          message: runtimeMessage,
        },
      ],
    },
  },
]);
