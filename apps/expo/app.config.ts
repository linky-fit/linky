import { readFileSync } from "node:fs";
import path from "node:path";
import type { ConfigContext, ExpoConfig } from "expo/config";
import { withFreshReleaseBundle } from "./plugins/withFreshReleaseBundle.ts";
import { withLinkySigning } from "./plugins/withLinkySigning.ts";
import { withLocalNetworking } from "./plugins/withLocalNetworking.ts";
import { withSceneLifecycle } from "./plugins/withSceneLifecycle.ts";

const variants = {
  dev: { id: "fit.linky.expo.dev", name: "Linky Expo Dev" },
  migrationqa: { id: "fit.linky.app.migrationqa", name: "Linky Migration QA" },
  production: { id: "fit.linky.app", name: "Linky" },
} as const;

type Variant = keyof typeof variants;

const isVariant = (value: string): value is Variant =>
  Object.hasOwn(variants, value);

const variantName = (value = "dev"): Variant => {
  if (isVariant(value)) return value;
  throw new Error(
    `LINKY_APP_VARIANT must be one of ${Object.keys(variants).join(", ")}, got "${value}".`,
  );
};

/** Release bundles use production services unless built against the local stack (metro.config.cjs loads .env.development). */
const usesLocalServices = (value = "production"): boolean => {
  if (value === "production" || value === "local") return value === "local";
  throw new Error(
    `LINKY_NATIVE_SERVICES must be production or local, got "${value}".`,
  );
};

const readAppVersion = (projectRoot: string): string => {
  const appPackage: unknown = JSON.parse(
    readFileSync(path.join(projectRoot, "../linky-app/package.json"), "utf8"),
  );
  if (
    typeof appPackage === "object" &&
    appPackage !== null &&
    "version" in appPackage &&
    typeof appPackage.version === "string"
  )
    return appPackage.version;
  throw new Error("apps/linky-app/package.json has no version.");
};

/** As the Capacitor app computes it (apps/native-shell/android/app/build.gradle): LINKY_ANDROID_VERSION_CODE, else 26.10.5 → 261005. */
const androidVersionCode = (version: string): number => {
  const override = process.env.LINKY_ANDROID_VERSION_CODE?.trim();
  const [major = 0, minor = 0, patch = 0] = version.split(".").map(Number);
  const code = override
    ? Number(override)
    : major * 10000 + minor * 100 + patch;
  if (!Number.isSafeInteger(code) || code < 1)
    throw new Error(
      `LINKY_ANDROID_VERSION_CODE must be a positive integer, got "${override}".`,
    );
  return code;
};

const cameraPermission =
  "Linky uses the camera to scan QR codes and to take photos for your profile and chats.";

export default ({ projectRoot }: ConfigContext): ExpoConfig => {
  const variant = variantName(process.env.LINKY_APP_VARIANT);
  const { id, name } = variants[variant];
  const version = readAppVersion(projectRoot);
  const localServices = usesLocalServices(process.env.LINKY_NATIVE_SERVICES);
  const appleTeamId = process.env.LINKY_IOS_TEAM ?? "W29Z32M73W";
  const config = withLinkySigning(
    withSceneLifecycle({
      name,
      slug: "linky",
      version,
      scheme: ["linky", "nostr", "cashu", "nostrconnect"],
      orientation: "portrait",
      // The app follows the system appearance itself; Expo's default pins iOS to light.
      userInterfaceStyle: "automatic",
      icon: "../native-shell/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png",
      ios: {
        bundleIdentifier: id,
        buildNumber: version,
        appleTeamId,
        entitlements: {
          "keychain-access-groups": [`$(AppIdentifierPrefix)${id}`],
        },
      },
      android: {
        package: id,
        versionCode: androidVersionCode(version),
        adaptiveIcon: {
          foregroundImage:
            "../native-shell/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png",
          backgroundColor: "#ffffff",
        },
        // Requested by modules for features Linky doesn't use: the dev overlay, step counting, biometric secure-store reads.
        blockedPermissions: [
          "android.permission.SYSTEM_ALERT_WINDOW",
          "android.permission.ACTIVITY_RECOGNITION",
          "android.permission.USE_BIOMETRIC",
          "android.permission.USE_FINGERPRINT",
        ],
        allowBackup: false,
        softwareKeyboardLayoutMode: "resize",
      },
      web: {
        bundler: "metro",
        output: "single",
        name: "Linky",
      },
      plugins: [
        "expo-router",
        "react-native-quick-crypto",
        "expo-sqlite",
        ["expo-secure-store", { faceIDPermission: false }],
        // The orientation sensors need no permission prompt.
        ["expo-sensors", { motionPermission: false }],
        "expo-font",
        "expo-sharing",
        [
          "expo-camera",
          {
            cameraPermission,
            microphonePermission: false,
            recordAudioAndroid: false,
          },
        ],
        [
          "expo-image-picker",
          {
            // The system photo picker needs no library access.
            photosPermission: false,
            cameraPermission,
            microphonePermission: false,
          },
        ],
        [
          "expo-media-library",
          {
            photosPermission: false,
            savePhotosPermission:
              "Linky saves the chat photos you choose to your photo library.",
            // Saving needs no read access to the library.
            granularPermissions: [],
          },
        ],
        [
          "expo-splash-screen",
          {
            backgroundColor: "#ffffff",
            image: "../linky-app/public/pwa-512x512.png",
            imageWidth: 120,
          },
        ],
      ],
      extra: {
        // The keychain group secureStore.native.ts writes to, the first in the entitlement above.
        keychainAccessGroup: `${appleTeamId}.${id}`,
      },
    }),
    { production: variant === "production" },
  );
  return withLocalNetworking(withFreshReleaseBundle(config), {
    cleartext: localServices,
    // Debug builds of the dev variant load their bundle from Metro over the LAN.
    localNetwork: localServices || variant === "dev",
  });
};
