import {
  platformIndependentEslintConfig,
  restrictedSyntax,
} from "@linky-fit/config/eslint";
import { defineConfig } from "eslint/config";

const clockMessage =
  "The package never reads a clock; take `now` as an argument.";

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
      "no-restricted-globals": [
        "error",
        ...["window", "document", "localStorage", "sessionStorage"].map(
          (name) => ({
            name,
            message:
              "This package is platform-independent: no browser globals.",
          }),
        ),
        {
          name: "fetch",
          message:
            "Use the injected `fetch`, so everything runs offline in tests.",
        },
      ],
      "no-restricted-syntax": [
        "error",
        ...restrictedSyntax,
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: clockMessage,
        },
      ],
    },
  },
]);
