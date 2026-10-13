import { readFileSync } from "node:fs";
import path from "node:path";
import type { ConfigContext, ExpoConfig } from "expo/config";
import { withLinkySigning } from "./plugins/withLinkySigning.ts";
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

/** The Capacitor app's formula (apps/native-shell/android/app/build.gradle): 26.10.5 → 261005. */
const androidVersionCode = (version: string): number => {
  const [major = 0, minor = 0, patch = 0] = version.split(".").map(Number);
  return major * 10000 + minor * 100 + patch;
};

export default ({ projectRoot }: ConfigContext): ExpoConfig => {
  const variant = variantName(process.env.LINKY_APP_VARIANT);
  const { id, name } = variants[variant];
  const version = readAppVersion(projectRoot);
  const appleTeamId = process.env.LINKY_IOS_TEAM ?? "W29Z32M73W";
  return withLinkySigning(
    withSceneLifecycle({
      name,
      slug: "linky",
      version,
      scheme: ["linky", "nostr", "cashu", "nostrconnect"],
      orientation: "portrait",
      ios: {
        bundleIdentifier: id,
        appleTeamId,
        entitlements: {
          "keychain-access-groups": [`$(AppIdentifierPrefix)${id}`],
        },
      },
      android: {
        package: id,
        versionCode: androidVersionCode(version),
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
        "expo-secure-store",
        "expo-font",
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
    { requireUploadKey: variant === "production" },
  );
};
