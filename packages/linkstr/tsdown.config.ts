import { prepareNpmPackage } from "@linky-fit/config/npm";
import { defineConfig } from "tsdown";
import manifest from "./package.json" with { type: "json" };

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "testing/index": "src/testing/index.ts",
  },
  format: "esm",
  platform: "neutral",
  target: "es2023",
  tsconfig: "tsconfig.app.json",
  dts: true,
  deps: { neverBundle: true },
  onSuccess: () => prepareNpmPackage(manifest),
});
