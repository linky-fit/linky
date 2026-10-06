import { prepareNpmPackage } from "@linky-fit/config/npm";
import { defineConfig } from "tsdown";
import manifest from "./package.json" with { type: "json" };

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "lnurl/lightningAddress": "src/lnurl/lightningAddress.ts",
    "paymentRequest/index": "src/paymentRequest/index.ts",
  },
  format: "esm",
  platform: "neutral",
  target: "es2023",
  tsconfig: "tsconfig.app.json",
  dts: true,
  deps: { neverBundle: true },
  onSuccess: () => prepareNpmPackage(manifest),
});
