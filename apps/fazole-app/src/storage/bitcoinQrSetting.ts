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
const bitcoinQrSettingId = createIdFromString<"Setting">(
  `setting/${BITCOIN_QR_KEY}`,
);

const BitcoinQrValue = Schema.Literals(["combined", "lightning"]);
const isBitcoinQrValue = Schema.is(BitcoinQrValue);

/** Whether the Bitcoin QR carries the Lightning invoice alone; combined with Cashu until the merchant changes it. */
export const readLightningOnlyQr = (
  settings: SettingsRepository,
): Effect.Effect<boolean> =>
  Effect.map(settings.byId(bitcoinQrSettingId), (row) => {
    const value = row?.value;
    return isBitcoinQrValue(value) && value === "lightning";
  });

export const saveLightningOnlyQr = (
  settings: SettingsRepository,
  lightningOnly: boolean,
): Effect.Effect<void, ShardDbError> =>
  settings.insert({
    id: bitcoinQrSettingId,
    key: NonEmptyString100.orThrow(BITCOIN_QR_KEY),
    value: NonEmptyString1000.orThrow(lightningOnly ? "lightning" : "combined"),
  });
