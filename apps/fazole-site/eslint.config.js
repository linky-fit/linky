import eslintConfig, {
  restrictedSyntax,
  uiOnlyPlugin,
} from "@linky-fit/config/eslint";
import { defineConfig } from "eslint/config";

const envSyntax = {
  selector: "MemberExpression[object.type='MetaProperty'][property.name='env']",
  message: "Read build-time env from src/config.ts.",
};

export default defineConfig([
  ...eslintConfig,
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/config.ts"],
    rules: {
      "@typescript-eslint/consistent-type-definitions": ["error", "interface"],
      "no-restricted-syntax": ["error", ...restrictedSyntax, envSyntax],
    },
  },
  {
    files: ["src/**/*.tsx"],
    plugins: { "linky-ui": uiOnlyPlugin },
    // Links stay real <a> elements, rendered through a ui component's `render` prop.
    rules: { "linky-ui/ui-only": ["error", { allow: ["a"] }] },
  },
]);
