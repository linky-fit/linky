import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export const webAppEslintConfig = defineConfig([
  globalIgnores(["dist", "dev-dist"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      "@typescript-eslint/consistent-type-assertions": [
        "error",
        { assertionStyle: "never" },
      ],
      // Unknown is allowed at parse/input boundaries only after guard narrowing.
      // Internal placeholders like Promise<unknown> / unknown[] are disallowed.
      "@typescript-eslint/no-explicit-any": [
        "error",
        {
          fixToUnknown: false,
          ignoreRestArgs: false,
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "TSAsExpression > TSAnyKeyword",
          message:
            "Do not use `as any`. Keep the value typed and narrow with runtime guards.",
        },
        {
          selector: "TSTypeAssertion > TSAnyKeyword",
          message:
            "Do not use `<any>` assertions. Keep the value typed and narrow with runtime guards.",
        },
        {
          selector: "TSArrayType > TSUnknownKeyword",
          message:
            "Do not use `unknown[]` placeholders in app logic. Use a concrete element type or narrow individual `unknown` values with guard functions.",
        },
        {
          selector:
            "TSTypeReference[typeName.name='Array'] > TSTypeParameterInstantiation > TSUnknownKeyword",
          message:
            "Do not use `Array<unknown>` placeholders in app logic. Use a concrete element type or narrow individual `unknown` values with guard functions.",
        },
        {
          selector:
            "TSTypeReference[typeName.name='ReadonlyArray'] > TSTypeParameterInstantiation > TSUnknownKeyword",
          message:
            "Do not use `ReadonlyArray<unknown>` placeholders in app logic. Use a concrete element type or narrow individual `unknown` values with guard functions.",
        },
        {
          selector:
            "TSTypeReference[typeName.name='Promise'] > TSTypeParameterInstantiation > TSUnknownKeyword",
          message:
            "Do not use `Promise<unknown>` placeholders in app logic. Use a concrete resolved type (for example `Promise<void>`) and keep `unknown` only at true parse/input boundaries before guard narrowing.",
        },
      ],
    },
  },
]);

export default webAppEslintConfig;
