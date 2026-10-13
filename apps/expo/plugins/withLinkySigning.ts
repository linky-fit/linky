// Node loads this file as native ESM, and expo has no exports map to resolve a bare subpath.
import { withAppBuildGradle, type ConfigPlugin } from "expo/config-plugins.js";

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

const linkyReleaseSigning = `            signingConfig linkyHasUploadKey ? signingConfigs.release : signingConfigs.debug`;

const uploadKeyCheck = `
def linkyHasUploadKey = ['LINKY_UPLOAD_STORE_FILE', 'LINKY_UPLOAD_STORE_PASSWORD', 'LINKY_UPLOAD_KEY_ALIAS', 'LINKY_UPLOAD_KEY_PASSWORD'].every { System.getenv(it)?.trim() }
`;

const requireUploadKeyTask = `
tasks.configureEach { task ->
    if ((task.name == 'bundleRelease' || task.name == 'assembleRelease') && !linkyHasUploadKey) {
        task.doFirst {
            throw new GradleException('Release signing is not configured. Set the LINKY_UPLOAD_* environment variables.')
        }
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
 * build falls back to the debug keystore, unless `requireUploadKey` makes it fail.
 */
export const withLinkySigning: ConfigPlugin<{ requireUploadKey: boolean }> = (
  config,
  { requireUploadKey },
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
    if (requireUploadKey) contents += requireUploadKeyTask;
    gradle.modResults.contents = contents;
    return gradle;
  });
