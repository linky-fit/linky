interface ImportMetaEnv {
  readonly VITE_EVOLU_SERVER_URLS?: string;
  /** Comma-separated relays the inbox reads by default; three public ones when unset. */
  readonly VITE_NOSTR_RELAYS?: string;
}
