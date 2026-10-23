import { AppDataIdentifier, AppNamespace } from "@linky-fit/linkstr";
import { Schema } from "effect";

/** The `app` tag of every transfer message between Linky and the on-chain operator. */
export const ONCHAIN_TRANSFER_APP_NAMESPACE: AppNamespace = AppNamespace.make(
  "linky.onchain-transfer",
);

/** The `d` tag of the on-chain operator's on-chain config event. */
export const ONCHAIN_CONFIG_IDENTIFIER: AppDataIdentifier =
  AppDataIdentifier.make("linky.onchain-transfer:config");

/** A deposit counts as received once it has this many confirmations. */
export const REQUIRED_CONFIRMATIONS = 2;

/** The amounts in sats an on-chain send can be made for when the config names none. */
export const DEFAULT_TRANSFER_AMOUNTS: readonly [number, ...number[]] = [
  100_000, 250_000, 500_000, 1_000_000,
];

/** The most sats an on-chain receive can be made for when the config names none. */
export const DEFAULT_MAX_RECEIVE_AMOUNT = 1_000_000;

export const OnchainTransferDirection = Schema.Literals(["send", "receive"]);
export type OnchainTransferDirection = typeof OnchainTransferDirection.Type;

/** `testnet` covers testnet3 and testnet4, which share address prefixes. */
export const BitcoinNetwork = Schema.Literals([
  "mainnet",
  "testnet",
  "signet",
  "regtest",
]);
export type BitcoinNetwork = typeof BitcoinNetwork.Type;
