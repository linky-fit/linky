import type { ShardDbError } from "@linky-fit/linksync";
import { Effect, Schema } from "effect";
import type { SettingsRepository } from "./shop";

const TIPS_KEY = "fazole.tips";

const TipsValue = Schema.Literals(["on", "off"]);
const isTipsValue = Schema.is(TipsValue);

/** Whether the terminal offers the customer a tip before the payment; on until the merchant turns it off. */
export const readOfferTips = (
  settings: SettingsRepository,
): Effect.Effect<boolean> =>
  Effect.map(
    settings.getRaw(TIPS_KEY),
    (value) => !(isTipsValue(value) && value === "off"),
  );

export const saveOfferTips = (
  settings: SettingsRepository,
  offer: boolean,
): Effect.Effect<void, ShardDbError> =>
  settings.setRaw(TIPS_KEY, offer ? "on" : "off");
