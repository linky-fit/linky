import eslintConfig, {
  restrictedSyntax,
  testHelperImportIgnores,
  testHelperImportPatterns,
} from "@linky-fit/config/eslint";
import { defineConfig, globalIgnores } from "eslint/config";

const httpMessage = "Outbound HTTP goes through safeFetch (api/_safeFetch.ts).";
const httpImportPatterns = [
  {
    group: ["undici", "undici/*", "node:http", "node:https", "http", "https"],
    message: httpMessage,
  },
];
const websiteMessage =
  "The site is a plain website: no service worker, no install prompt.";

export default defineConfig([
  globalIgnores(["lnurlw/bundle.js"]),
  ...eslintConfig,
  {
    files: ["{api,lnurlw}/**/*.{ts,tsx}"],
    ignores: ["api/_safeFetch.ts"],
    rules: {
      "no-restricted-globals": [
        "error",
        {
          globals: [{ name: "fetch", message: httpMessage }],
          checkGlobalObject: true,
        },
      ],
      "no-restricted-imports": [
        "error",
        {
          patterns: [...testHelperImportPatterns, ...httpImportPatterns],
        },
      ],
    },
  },
  {
    files: testHelperImportIgnores.map((pattern) => [
      "{api,lnurlw}/**/*.{ts,tsx}",
      pattern,
    ]),
    rules: {
      "no-restricted-imports": ["error", { patterns: httpImportPatterns }],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "navigator",
          property: "serviceWorker",
          message: websiteMessage,
        },
        { property: "onbeforeinstallprompt", message: websiteMessage },
      ],
      "no-restricted-globals": [
        "error",
        { name: "onbeforeinstallprompt", message: websiteMessage },
      ],
      "no-restricted-syntax": [
        "error",
        ...restrictedSyntax,
        {
          selector: "Literal[value='beforeinstallprompt']",
          message: websiteMessage,
        },
      ],
    },
  },
]);
