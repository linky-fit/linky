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

/** Fresh-origin defaults, Linky's own; `.env.development` points them at the local services. */
export interface AppConfig {
  readonly nostrRelays: readonly RelayUrl[];
  /** Replaces Linky's recommended Evolu relays when non-empty. */
  readonly evoluRelayDefaults: readonly string[];
  readonly recommendedEvoluRelays: readonly string[];
  /** The mint every transfer's ecash is at. */
  readonly mintUrl: string;
  readonly allowInsecureLocalhostRelays: boolean;
  /** The Blossom server pictures are uploaded to. */
  readonly blossomServerUrl: string;
  readonly network: BitcoinNetwork;
  /** An Esplora HTTP API root, e.g. `https://mempool.space/api`. */
  readonly esploraUrl: string;
  /** A block explorer's web root the transfer links point to. */
  readonly explorerUrl: string;
}

export interface AppConfigInput {
  readonly nostrRelays?: string | undefined;
  readonly evoluRelays?: string | undefined;
  readonly mintUrl?: string | undefined;
  readonly allowInsecureLocalhostRelays?: boolean | undefined;
  readonly blossomServerUrl?: string | undefined;
  readonly network?: string | undefined;
  readonly esploraUrl?: string | undefined;
  readonly explorerUrl?: string | undefined;
}

export const resolveAppConfig = (input: AppConfigInput = {}): AppConfig => {
  const customNostrRelays = list(input.nostrRelays);
  return {
    nostrRelays: (customNostrRelays.length > 0
      ? customNostrRelays
      : recommended.nostr
    ).filter(Schema.is(RelayUrl)),
    evoluRelayDefaults: list(input.evoluRelays),
    recommendedEvoluRelays: recommended.evolu,
    mintUrl: input.mintUrl?.trim() || "https://cashu.cz",
    allowInsecureLocalhostRelays: input.allowInsecureLocalhostRelays ?? false,
    blossomServerUrl:
      input.blossomServerUrl?.trim() || "https://blossom.primal.net",
    network: Schema.decodeUnknownSync(BitcoinNetwork)(
      input.network?.trim() || "mainnet",
    ),
    esploraUrl: input.esploraUrl?.trim() || "https://mempool.space/api",
    explorerUrl: input.explorerUrl?.trim() || "https://mempool.space",
  };
};
