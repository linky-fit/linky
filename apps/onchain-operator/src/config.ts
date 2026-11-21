import { resolveAppConfig } from "./appConfig";

export type { AppConfig } from "./appConfig";

const env = import.meta.env;

export const appConfig = resolveAppConfig({
  nostrRelays: env.VITE_NOSTR_RELAYS,
  evoluRelays: env.VITE_EVOLU_SERVER_URLS,
  mintUrl: env.VITE_MAIN_MINT_URL,
  allowInsecureLocalhostRelays:
    env.VITE_ALLOW_INSECURE_LOCALHOST_RELAYS === "1",
  blossomServerUrl: env.VITE_BLOSSOM_SERVER_URL,
  network: env.VITE_BITCOIN_NETWORK,
  esploraUrl: env.VITE_ESPLORA_URL,
  explorerUrl: env.VITE_EXPLORER_URL,
});
