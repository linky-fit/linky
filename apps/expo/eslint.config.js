import config from "@linky-fit/config/eslint";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([...config, globalIgnores([".expo", "public"])]);
