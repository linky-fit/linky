import { createIdFromString } from "@linky-fit/domain";
import {
  NonEmptyString100,
  NonEmptyString1000,
  type ShardDbError,
} from "@linky-fit/linksync";
import { Effect, Schema } from "effect";
import type { SettingsRepository } from "./shop";

const BITCOIN_QR_KEY = "fazole.bitcoinQr";
// Mirrors linksync's `settingIdFor`, whose keys are Linky's own settings only.
export const bitcoinQrSettingId = createIdFromString<"Setting">(
  `setting/${BITCOIN_QR_KEY}`,
);

/** What the Bitcoin QR carries: both legs as a BIP-321 URI, the Cashu request alone, or the Lightning invoice alone. */
export const BITCOIN_QR_MODES = ["universal", "cashu", "lightning"] as const;
export type BitcoinQrMode = (typeof BITCOIN_QR_MODES)[number];

// The universal mode is stored as "combined", the value the first release wrote.
const StoredValue = Schema.Literals(["combined", "cashu", "lightning"]);
const isStoredValue = Schema.is(StoredValue);

/** The Bitcoin QR mode; universal until the merchant changes it. */
export const readBitcoinQrMode = (
  settings: SettingsRepository,
): Effect.Effect<BitcoinQrMode> =>
  Effect.map(settings.byId(bitcoinQrSettingId), (row) => {
    const value = row?.value;
    return isStoredValue(value) && value !== "combined" ? value : "universal";
  });

export const saveBitcoinQrMode = (
  settings: SettingsRepository,
  mode: BitcoinQrMode,
): Effect.Effect<void, ShardDbError> =>
  settings.insert({
    id: bitcoinQrSettingId,
    key: NonEmptyString100.orThrow(BITCOIN_QR_KEY),
    value: NonEmptyString1000.orThrow(mode === "universal" ? "combined" : mode),
  });
