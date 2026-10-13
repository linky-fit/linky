import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

// apps/linky-app's Capacitor plugins ship native code that only the Capacitor shell builds.
const webAppPackage: { dependencies?: Record<string, string> } = JSON.parse(
  readFileSync(
    createRequire(import.meta.url).resolve("@linky-fit/linky-app/package.json"),
    "utf8",
  ),
);

const capacitorPlugins = Object.keys(webAppPackage.dependencies ?? {}).filter(
  (name) => name.startsWith("@capacitor/"),
);

export default {
  dependencies: Object.fromEntries(
    capacitorPlugins.map((name) => [
      name,
      { platforms: { ios: null, android: null } },
    ]),
  ),
};
