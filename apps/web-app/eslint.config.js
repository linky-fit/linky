import webAppEslintConfig, {
  restrictedSyntax,
  testHelperImportPatterns,
  testHelperImportIgnores,
} from "@linky-fit/config/eslint";
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

const backSyntax = [
  {
    selector:
      "CallExpression[callee.property.name=/^(back|go)$/]:matches([callee.object.name='history'], [callee.object.object.name='window'][callee.object.property.name='history'])",
    message:
      "Back is resolveBackAction() (hooks/useRouting.ts / topbar) because hash navigation only grows history and a cold-start deep link has nothing to return to.",
  },
];
const evoluImportPatterns = [
  {
    group: ["@evolu/*"],
    message:
      "Take Evolu re-exports from @linky-fit/linksync; only src/evolu.ts and src/app/migrations import @evolu/* directly.",
  },
];
const wipeImportPatterns = [
  {
    group: ["**/evolu", "**/evolu.ts"],
    importNames: ["wipeEvoluStorage"],
    message:
      "The WASM-OOM recovery is the only automatic wipe; local data is otherwise cleared only by the user.",
  },
];

export default defineConfig([
  ...webAppEslintConfig,
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
            ...wipeImportPatterns,
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
        ...backSyntax,
        ...storageSyntax,
        ...navigationSyntax,
      ],
    },
  },
  {
    files: ["src/evolu.ts", "src/app/migrations/**"],
    ignores: testHelperImportIgnores,
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [...testHelperImportPatterns, ...wipeImportPatterns] },
      ],
      "no-restricted-properties": "off",
    },
  },
  {
    files: ["src/app/useAppShellComposition.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [...testHelperImportPatterns, ...evoluImportPatterns] },
      ],
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
        ...backSyntax,
        ...navigationSyntax,
      ],
    },
  },
  {
    files: ["src/hooks/useRouting.ts", "src/utils/spdPayment.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...restrictedSyntax,
        ...backSyntax,
        ...storageSyntax,
      ],
    },
  },
]);
