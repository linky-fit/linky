// Node loads this file as native ESM: expo has no exports map to resolve a bare subpath,
// and Node 22 sees only some named exports of this CommonJS module.
import configPlugins, { type ConfigPlugin } from "expo/config-plugins.js";

const { withAppBuildGradle } = configPlugins;

const templateSigningConfigs = `    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }`;

// Same keystore as the Capacitor debug build, so an Expo build can update it in place.
const linkySigningConfigs = `    signingConfigs {
        debug {
            storeFile file(System.getenv('LINKY_ANDROID_DEBUG_KEYSTORE') ?: "\${System.getProperty('user.home')}/.android/debug.keystore")
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
        if (linkyHasUploadKey) {
            release {
                storeFile file(System.getenv('LINKY_UPLOAD_STORE_FILE'))
                storePassword System.getenv('LINKY_UPLOAD_STORE_PASSWORD')
                keyAlias System.getenv('LINKY_UPLOAD_KEY_ALIAS')
                keyPassword System.getenv('LINKY_UPLOAD_KEY_PASSWORD')
            }
        }
    }`;

const templateReleaseSigning = `            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug`;

const linkyReleaseSigning = `            signingConfig linkyHasUploadKey ? signingConfigs.release : signingConfigs.debug
            if (!linkyHasUploadKey) versionNameSuffix '-qa'`;

const uploadKeyCheck = `
def linkyHasUploadKey = ['LINKY_UPLOAD_STORE_FILE', 'LINKY_UPLOAD_STORE_PASSWORD', 'LINKY_UPLOAD_KEY_ALIAS', 'LINKY_UPLOAD_KEY_PASSWORD'].every { System.getenv(it)?.trim() }
`;

/** Google Play holds the Capacitor builds' version codes, 200001000 + run number (.github/actions/android-release-setup). */
const playVersionCodeFloor = 200001000;

const productionReleaseChecks = `
        if (!linkyHasUploadKey) throw new GradleException('The production variant signs releases only with the upload key. Set the LINKY_UPLOAD_* environment variables.')
        if (android.defaultConfig.versionCode <= ${playVersionCodeFloor}) throw new GradleException("The production variant needs LINKY_ANDROID_VERSION_CODE above ${playVersionCodeFloor}, or Google Play rejects it as older than the Capacitor builds; got \${android.defaultConfig.versionCode}.")`;

const qaReleaseWarning = `
        if (!linkyHasUploadKey) logger.warn('LINKY_UPLOAD_* is not set: signing the release with the debug keystore as a local QA build (version name suffix -qa), not for distribution.')`;

// Runs once the task graph is known, so a refused release stops before compiling anything.
const releaseCheck = (checks: string) => `
gradle.taskGraph.whenReady { graph ->
    if (graph.allTasks.any { it.project == project && it.name in ['packageRelease', 'signReleaseBundle'] }) {${checks}
    }
}
`;

const replaceOnce = (source: string, from: string, to: string): string => {
  if (!source.includes(from))
    throw new Error(
      `withLinkySigning: android/app/build.gradle no longer contains:\n${from}`,
    );
  return source.replace(from, to);
};

/**
 * Debug builds sign with LINKY_ANDROID_DEBUG_KEYSTORE (default ~/.android/debug.keystore),
 * release builds with the Capacitor app's LINKY_UPLOAD_* key. Without that key a release
 * build is a local QA build: debug-signed, its version name suffixed `-qa`, and it warns.
 * A `production` release refuses it, and refuses a version code Google Play would reject.
 */
export const withLinkySigning: ConfigPlugin<{ production: boolean }> = (
  config,
  { production },
) =>
  withAppBuildGradle(config, (gradle) => {
    let contents = replaceOnce(
      gradle.modResults.contents,
      templateSigningConfigs,
      linkySigningConfigs,
    );
    contents = replaceOnce(
      contents,
      templateReleaseSigning,
      linkyReleaseSigning,
    );
    contents = replaceOnce(
      contents,
      "\nandroid {",
      `${uploadKeyCheck}\nandroid {`,
    );
    contents += releaseCheck(
      production ? productionReleaseChecks : qaReleaseWarning,
    );
    gradle.modResults.contents = contents;
    return gradle;
  });
