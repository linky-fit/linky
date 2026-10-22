import recommendedRelays from "@linky-fit/linky-site/recommended-relays.json";
import { RelayUrl } from "@linky-fit/linkstr";
import { BitcoinNetwork } from "@linky-fit/onchain-transfer";
import { Schema } from "effect";

const RecommendedRelays = Schema.Struct({
  nostr: Schema.Array(Schema.String),
  evolu: Schema.Array(Schema.String),
});
const recommended =
  Schema.decodeUnknownSync(RecommendedRelays)(recommendedRelays);

const list = (value: string | undefined): readonly string[] =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const env = import.meta.env;
const envNostrRelays = list(env.VITE_NOSTR_RELAYS);

/** Fresh-origin defaults, Linky's own; `.env.development` points them at the local services. */
export interface AppConfig {
  readonly nostrRelays: readonly RelayUrl[];
  /** Replaces Linky's recommended Evolu relays when non-empty. */
  readonly evoluRelayDefaults: readonly string[];
  readonly recommendedEvoluRelays: readonly string[];
  /** The mint every transfer's ecash is at. */
  readonly mintUrl: string;
  readonly allowInsecureLocalhostRelays: boolean;
  readonly network: BitcoinNetwork;
  /** An Esplora HTTP API root, e.g. `https://mempool.space/api`. */
  readonly esploraUrl: string;
  /** A block explorer's web root the transfer links point to. */
  readonly explorerUrl: string;
}

export const appConfig: AppConfig = {
  nostrRelays: (envNostrRelays.length > 0
    ? envNostrRelays
    : recommended.nostr
  ).filter(Schema.is(RelayUrl)),
  evoluRelayDefaults: list(env.VITE_EVOLU_SERVER_URLS),
  recommendedEvoluRelays: recommended.evolu,
  mintUrl: env.VITE_MAIN_MINT_URL?.trim() || "https://cashu.cz",
  allowInsecureLocalhostRelays:
    env.VITE_ALLOW_INSECURE_LOCALHOST_RELAYS === "1",
  network: Schema.decodeUnknownSync(BitcoinNetwork)(
    env.VITE_BITCOIN_NETWORK?.trim() || "mainnet",
  ),
  esploraUrl: env.VITE_ESPLORA_URL?.trim() || "https://mempool.space/api",
  explorerUrl: env.VITE_EXPLORER_URL?.trim() || "https://mempool.space",
};
