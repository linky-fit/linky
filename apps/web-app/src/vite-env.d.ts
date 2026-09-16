/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare const __APP_VERSION__: string;
declare const __APP_COMMIT_SHA__: string;

interface ImportMetaEnv {
  readonly VITE_ALLOW_INSECURE_LOCALHOST_RELAYS?: string;
  readonly VITE_NOSTR_RELAYS?: string;
  readonly VITE_NOSTR_SEARCH_RELAYS?: string;
  readonly VITE_EVOLU_SERVER_URLS?: string;
  readonly VITE_MAIN_MINT_URL?: string;
  readonly VITE_NPUB_CASH_DISABLED?: string;
  readonly VITE_PUSH_SERVER_URL?: string;
  readonly VITE_NOTIFICATION_SERVER_URL?: string;
}
