/// <reference types="vite-plugin-pwa/client" />
/// <reference types="vite/client" />

declare const __APP_VERSION__: string;
/** Short commit sha of the build; empty when unknown. */
declare const __APP_COMMIT_SHA__: string;

interface ImportMetaEnv {
  /** Comma-separated Nostr relay URLs; replaces Linky's recommended relays. */
  readonly VITE_NOSTR_RELAYS?: string;
  /** Comma-separated Evolu relay URLs; replaces Linky's recommended relays. */
  readonly VITE_EVOLU_SERVER_URLS?: string;
  readonly VITE_MAIN_MINT_URL?: string;
  /** "1" allows ws:// relays on localhost. */
  readonly VITE_ALLOW_INSECURE_LOCALHOST_RELAYS?: string;
}
