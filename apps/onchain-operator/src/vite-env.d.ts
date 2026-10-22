/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Comma-separated Nostr relay URLs; replaces Linky's recommended relays. */
  readonly VITE_NOSTR_RELAYS?: string;
  /** Comma-separated Evolu relay URLs; replaces Linky's recommended relays. */
  readonly VITE_EVOLU_SERVER_URLS?: string;
  readonly VITE_MAIN_MINT_URL?: string;
  /** "1" allows ws:// relays on localhost. */
  readonly VITE_ALLOW_INSECURE_LOCALHOST_RELAYS?: string;
  /** `mainnet`, `testnet`, `signet` or `regtest`. */
  readonly VITE_BITCOIN_NETWORK?: string;
  readonly VITE_ESPLORA_URL?: string;
  readonly VITE_EXPLORER_URL?: string;
}
