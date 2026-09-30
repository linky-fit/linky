import {
  platformIndependentEslintConfig,
  restrictedSyntax,
} from "@linky-fit/config/eslint";
import { defineConfig } from "eslint/config";

const clockMessage =
  "The package never reads a clock; take `nowSec` as an argument.";

export default defineConfig([
  ...platformIndependentEslintConfig,
  {
    files: ["src/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        { object: "Date", property: "now", message: clockMessage },
      ],
      "no-restricted-syntax": [
        "error",
        ...restrictedSyntax,
        {
          selector: "NewExpression[callee.name='Date']",
          message: clockMessage,
        },
      ],
    },
  },
]);
