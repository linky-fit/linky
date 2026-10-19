// Metro resolves apps/linky-app/src/platform/buildEnv.ts to this module; Expo
// inlines process.env.EXPO_PUBLIC_* at build time. buildEnv.contract.ts keeps
// the exports in step.

declare const __DEV__: boolean;

export const isDevBuild: boolean = __DEV__;
/** Expo's dev server serves no service worker. */
export const devServiceWorkerUrl: string | null = null;
/** Installs the Playwright test hooks (`window.__linkyE2E`) in a production build. */
export const isE2eBuild = process.env.EXPO_PUBLIC_E2E === "1";
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
/** Origin serving the Linky `/api/*` functions; empty for the page's own origin. */
export const apiOrigin: string = process.env.EXPO_PUBLIC_API_ORIGIN ?? "";
/** Origin of the dev server collecting inspector rows; empty for the page's own origin. */
export const inspectorCollectorOrigin: string = "";
