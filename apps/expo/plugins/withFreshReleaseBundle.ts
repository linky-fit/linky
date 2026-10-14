// Node loads this file as native ESM: expo has no exports map to resolve a bare subpath,
// and Node 22 sees only some named exports of this CommonJS module.
import configPlugins, { type ConfigPlugin } from "expo/config-plugins.js";

const { withAppBuildGradle } = configPlugins;

// React Native's bundle task tracks only files under apps/expo, so a change in
// apps/linky-app or packages/* would leave a stale bundle in the next release build.
const alwaysBundle = `
tasks.matching { it.name.startsWith('createBundle') && it.name.endsWith('JsAndAssets') }.configureEach {
    outputs.upToDateWhen { false }
}
`;

/** Android release builds re-run Metro every time, as the Xcode bundle phase does. */
export const withFreshReleaseBundle: ConfigPlugin = (config) =>
  withAppBuildGradle(config, (gradle) => {
    gradle.modResults.contents += alwaysBundle;
    return gradle;
  });
