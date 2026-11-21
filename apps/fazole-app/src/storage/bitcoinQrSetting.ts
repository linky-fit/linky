import type { ShardDbError } from "@linky-fit/linksync";
import { Effect, Schema } from "effect";
import type { SettingsRepository } from "./shop";

export const BITCOIN_QR_SETTING_KEY = "fazole.bitcoinQr";

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
  Effect.map(settings.getRaw(BITCOIN_QR_SETTING_KEY), (value) =>
    isStoredValue(value) && value !== "combined" ? value : "universal",
  );

export const saveBitcoinQrMode = (
  settings: SettingsRepository,
  mode: BitcoinQrMode,
): Effect.Effect<void, ShardDbError> =>
  settings.setRaw(
    BITCOIN_QR_SETTING_KEY,
    mode === "universal" ? "combined" : mode,
  );
