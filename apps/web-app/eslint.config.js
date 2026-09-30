import webAppEslintConfig, { restrictedSyntax } from "@linky-fit/config/eslint";
import { defineConfig } from "eslint/config";

const storageMessage =
  "Browser storage goes through utils/storage.ts (safeLocalStorage* / safeSessionStorage* helpers).";
const navigateMessage = "Navigate with navigateTo() from hooks/useRouting.ts.";
const evoluMessage =
  "App code never calls the Evolu instance; read and write through the @linky-fit/linksync repositories (app/hooks/useLinksync.ts).";

const storageSyntax = [
  {
    selector:
      "MemberExpression[object.name=/^(window|globalThis)$/][property.name=/^(localStorage|sessionStorage)$/]",
    message: storageMessage,
  },
];
const onLocation = (path) =>
  `:matches([${path}.object.name='location'], [${path}.object.property.name='location'])`;
const navigationSyntax = [
  {
    selector: `CallExpression[callee.property.name=/^(assign|replace)$/]${onLocation("callee")}`,
    message: navigateMessage,
  },
  {
    selector: `AssignmentExpression[left.property.name=/^(hash|href)$/]${onLocation("left")}`,
    message: navigateMessage,
  },
];

export default defineConfig([
  ...webAppEslintConfig,
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["**/*.test.{ts,tsx}", "src/testUtils/**"],
    rules: {
      "@typescript-eslint/consistent-type-definitions": ["error", "interface"],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@evolu/*"],
              message:
                "Take Evolu re-exports from @linky-fit/linksync; only src/evolu.ts and src/app/migrations import @evolu/* directly.",
            },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        { name: "localStorage", message: storageMessage },
        { name: "sessionStorage", message: storageMessage },
      ],
      "no-restricted-properties": [
        "error",
        ...[
          "useQuery",
          "useOwner",
          "upsert",
          "insert",
          "update",
          "createQuery",
          "loadQuery",
          "subscribeQuery",
        ].map((property) => ({
          object: "evolu",
          property,
          message: evoluMessage,
        })),
      ],
      "no-restricted-syntax": [
        "error",
        ...restrictedSyntax,
        ...storageSyntax,
        ...navigationSyntax,
      ],
    },
  },
  {
    files: ["src/evolu.ts", "src/app/migrations/**"],
    rules: {
      "no-restricted-imports": "off",
      "no-restricted-properties": "off",
    },
  },
  {
    files: ["src/devtools/e2e/**"],
    rules: { "no-restricted-properties": "off" },
  },
  {
    files: [
      "src/utils/storage.ts",
      "src/platform/linkshu/localStorageKeyValueStore.ts",
      "src/app/migrations/linkshuStorageMigration.ts",
      "src/app/hooks/useLinkstrConfigSync.ts",
    ],
    rules: {
      "no-restricted-globals": "off",
      "no-restricted-syntax": [
        "error",
        ...restrictedSyntax,
        ...navigationSyntax,
      ],
    },
  },
  {
    files: ["src/hooks/useRouting.ts", "src/utils/spdPayment.ts"],
    rules: {
      "no-restricted-syntax": ["error", ...restrictedSyntax, ...storageSyntax],
    },
  },
]);
