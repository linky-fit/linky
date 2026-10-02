import { readFileSync } from "node:fs";

const rootManifest = new URL("../../package.json", import.meta.url);
const { version } = JSON.parse(readFileSync(rootManifest, "utf8"));

/** @type {import("electron-builder").Configuration} */
export default {
  appId: "fit.linky.desktop",
  // The desktop app ships under the app's CalVer release tag.
  extraMetadata: { version },
  directories: { output: "release" },
  files: ["dist/**", "assets/**"],
  mac: {
    target: [{ target: "dmg", arch: "arm64" }],
    category: "public.app-category.finance",
    // The beta is ad-hoc signed: no Developer ID, so no notarization either.
    identity: "-",
    hardenedRuntime: false,
    extendInfo: {
      NSCameraUsageDescription: "Linky scans QR codes with the camera.",
    },
  },
  dmg: { artifactName: "linky-mac-arm64.dmg" },
};
