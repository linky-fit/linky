// Metro resolves apps/linky-app/src/platform/buildEnv.ts to this module on iOS
// and Android; Expo inlines process.env.EXPO_PUBLIC_* at build time.

import Constants from "expo-constants";

declare const __DEV__: boolean;

export const isDevBuild: boolean = __DEV__;
export const devServiceWorkerUrl: string | null = null;
export const isE2eBuild = false;
export const allowInsecureLocalhostRelays =
  process.env.EXPO_PUBLIC_ALLOW_INSECURE_LOCALHOST_RELAYS === "1";
export const npubCashDisabled =
  process.env.EXPO_PUBLIC_NPUB_CASH_DISABLED === "true";

export const envNostrRelays = process.env.EXPO_PUBLIC_NOSTR_RELAYS;
export const envNostrSearchRelays = process.env.EXPO_PUBLIC_NOSTR_SEARCH_RELAYS;
export const envEvoluServerUrls = process.env.EXPO_PUBLIC_EVOLU_SERVER_URLS;
export const envMainMintUrl = process.env.EXPO_PUBLIC_MAIN_MINT_URL;
export const envPushServerUrl = process.env.EXPO_PUBLIC_PUSH_SERVER_URL;
export const envNotificationServerUrl =
  process.env.EXPO_PUBLIC_NOTIFICATION_SERVER_URL;
/** The app has no page origin, so `/api/*` goes to the hosted app unless the build names another. */
export const apiOrigin: string =
  process.env.EXPO_PUBLIC_API_ORIGIN || "https://app.linky.fit";
/** Dev builds report inspector rows to the Metro server that served the bundle. */
export const inspectorCollectorOrigin: string =
  __DEV__ && Constants.expoConfig?.hostUri
    ? `http://${Constants.expoConfig.hostUri}`
    : "";
