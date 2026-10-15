import type { CapacitorConfig } from "@capacitor/cli";

const nativeBackgroundColor = "#0b1222";

const resolveLiveReloadUrl = (): string | null => {
  const candidate =
    process.env.LINKY_CAP_SERVER_URL?.trim() ??
    process.env.CAP_SERVER_URL?.trim() ??
    "";

  return candidate || null;
};

const liveReloadUrl = resolveLiveReloadUrl();

const config: CapacitorConfig = {
  appId: "fit.linky.app",
  appName: "Linky",
  webDir: "../linky-app/dist",
  android: {
    backgroundColor: nativeBackgroundColor,
  },
  ios: {
    backgroundColor: nativeBackgroundColor,
  },
  ...(liveReloadUrl
    ? {
        server: {
          url: liveReloadUrl,
          cleartext: liveReloadUrl.startsWith("http://"),
          androidScheme: liveReloadUrl.startsWith("http://") ? "http" : "https",
          iosScheme: "https",
        },
      }
    : {}),
};

export default config;
