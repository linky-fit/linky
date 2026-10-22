import { AppDataDraft, type AppDataEvent } from "@linky-fit/linkstr";
import { Option, Schema } from "effect";
import { BitcoinNetwork, ONCHAIN_CONFIG_IDENTIFIER } from "./constants";
import { BasisPoints, NonEmptyText, PositiveInt } from "./schema";

/** A Linky version, CalVer `YY.M.MICRO`. */
export const ClientVersion = Schema.String.check(
  Schema.isPattern(/^\d+\.\d+\.\d+$/u),
);

/** The on-chain operator's public terms, published as a NIP-78 event. */
export const OnchainConfig = Schema.Struct({
  v: Schema.Literal(1),
  feeBasisPoints: BasisPoints,
  /** No new transfers are accepted while paused. */
  paused: Schema.Boolean,
  description: Schema.String.check(Schema.isMaxLength(1000)),
  /** The amounts in sats a transfer can be made for. */
  amounts: Schema.NonEmptyArray(PositiveInt),
  /** Ecash of every transfer is at this mint. */
  mintUrl: NonEmptyText(1000),
  network: BitcoinNetwork,
  /** A block explorer's web root, e.g. `https://mempool.space`. */
  explorerUrl: NonEmptyText(1000),
  /** The oldest Linky version the operator serves; an older one asks its user to update. */
  minClientVersion: Schema.optionalKey(ClientVersion),
});
export type OnchainConfig = typeof OnchainConfig.Type;

const OnchainConfigJson = Schema.fromJsonString(OnchainConfig);

/** The app data draft the operator publishes its config with. */
export const onchainConfigDraft = (config: OnchainConfig): AppDataDraft =>
  new AppDataDraft({
    identifier: ONCHAIN_CONFIG_IDENTIFIER,
    content: Schema.encodeSync(OnchainConfigJson)(config),
  });

/** The config an event carries; check the author is the on-chain operator before trusting it. */
export const decodeOnchainConfig = (
  event: AppDataEvent,
): Option.Option<OnchainConfig> =>
  event.identifier === ONCHAIN_CONFIG_IDENTIFIER
    ? Schema.decodeUnknownOption(OnchainConfigJson)(event.content)
    : Option.none();

const versionParts = (version: string): readonly number[] | null =>
  Schema.is(ClientVersion)(version) ? version.split(".").map(Number) : null;

/** Whether a Linky of `clientVersion` may make transfers under `config`; an unreadable version may not once a minimum is set. */
export const isClientVersionSupported = (
  config: OnchainConfig,
  clientVersion: string,
): boolean => {
  if (config.minClientVersion === undefined) return true;
  const client = versionParts(clientVersion);
  const minimum = versionParts(config.minClientVersion);
  if (client === null || minimum === null) return false;
  for (const [index, part] of minimum.entries()) {
    const clientPart = client[index] ?? 0;
    if (clientPart !== part) return clientPart > part;
  }
  return true;
};
