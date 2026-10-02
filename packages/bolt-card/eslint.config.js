import { platformIndependentEslintConfig } from "@linky-fit/config/eslint";
import { defineConfig } from "eslint/config";

export default defineConfig([...platformIndependentEslintConfig]);
