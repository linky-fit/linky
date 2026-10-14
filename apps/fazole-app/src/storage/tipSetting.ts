import { createIdFromString } from "@linky-fit/domain";
import {
  NonEmptyString100,
  NonEmptyString1000,
  type ShardDbError,
} from "@linky-fit/linksync";
import { Effect, Schema } from "effect";
import type { SettingsRepository } from "./shop";

const TIPS_KEY = "fazole.tips";
// Mirrors linksync's `settingIdFor`, whose keys are Linky's own settings only.
const tipsSettingId = createIdFromString<"Setting">(`setting/${TIPS_KEY}`);

const TipsValue = Schema.Literals(["on", "off"]);
const isTipsValue = Schema.is(TipsValue);

/** Whether the terminal offers the customer a tip before the payment; on until the merchant turns it off. */
export const readOfferTips = (
  settings: SettingsRepository,
): Effect.Effect<boolean> =>
  Effect.map(settings.byId(tipsSettingId), (row) => {
    const value = row?.value;
    return !(isTipsValue(value) && value === "off");
  });

export const saveOfferTips = (
  settings: SettingsRepository,
  offer: boolean,
): Effect.Effect<void, ShardDbError> =>
  settings.insert({
    id: tipsSettingId,
    key: NonEmptyString100.orThrow(TIPS_KEY),
    value: NonEmptyString1000.orThrow(offer ? "on" : "off"),
  });
