/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  /** Signer app the demo opens; `linkyWebAppUrl` by default. */
  readonly VITE_LINKY_APP_URL?: string;
  /** Comma-separated relays for the cross-device login; the recommended relays by default. */
  readonly VITE_NOSTR_RELAYS?: string;
}
