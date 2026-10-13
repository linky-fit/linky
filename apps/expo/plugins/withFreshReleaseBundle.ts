// Node loads this file as native ESM, and expo has no exports map to resolve a bare subpath.
import { withAppBuildGradle, type ConfigPlugin } from "expo/config-plugins.js";

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
