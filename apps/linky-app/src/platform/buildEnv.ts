// The only module that reads import.meta.env, so a bundler without Vite's env
// replaces just this file. Values are fixed at build time.

export const isDevBuild: boolean = import.meta.env.DEV;
/** vite-plugin-pwa serves the development service worker as an ES module under its own name. */
export const devServiceWorkerUrl: string | null = "/dev-sw.js?dev-sw";
/** Installs the Playwright test hooks (`window.__linkyE2E`) in a production build. */
export const isE2eBuild = import.meta.env.VITE_E2E === "1";
export const allowInsecureLocalhostRelays =
  import.meta.env.VITE_ALLOW_INSECURE_LOCALHOST_RELAYS === "1";
export const npubCashDisabled =
  import.meta.env.VITE_NPUB_CASH_DISABLED === "true";

export const envNostrRelays = import.meta.env.VITE_NOSTR_RELAYS;
export const envNostrSearchRelays = import.meta.env.VITE_NOSTR_SEARCH_RELAYS;
export const envEvoluServerUrls = import.meta.env.VITE_EVOLU_SERVER_URLS;
export const envMainMintUrl = import.meta.env.VITE_MAIN_MINT_URL;
export const envPushServerUrl = import.meta.env.VITE_PUSH_SERVER_URL;
export const envNotificationServerUrl = import.meta.env
  .VITE_NOTIFICATION_SERVER_URL;
/** Origin serving the Linky `/api/*` functions; empty for the page's own origin. */
export const apiOrigin: string = "";
