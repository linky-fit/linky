import { Option, Schema } from "effect";
import {
  safeLocalStorageGet,
  safeLocalStorageRemove,
  safeLocalStorageSet,
} from "../../utils/storage";

const ENABLED_STORAGE_KEY = "linky.beacon.enabled.v1";
const TRADE_STORAGE_KEY = "linky.beacon.trade.v1";
const INTRO_SEEN_STORAGE_KEY = "linky.beacon.introSeen.v1";

export const BeaconTrade = Schema.Literal("buy", "sell", "none");
export type BeaconTrade = typeof BeaconTrade.Type;

const StoredTrade = Schema.Literal("buy", "sell");
const StoredFlag = Schema.Literal("true");

const readFlag = (key: string): boolean =>
  Schema.is(StoredFlag)(safeLocalStorageGet(key));

const writeFlag = (key: string, on: boolean): void => {
  if (on) safeLocalStorageSet(key, "true");
  else safeLocalStorageRemove(key);
};

export const readBeaconEnabled = (): boolean => readFlag(ENABLED_STORAGE_KEY);

export const writeBeaconEnabled = (enabled: boolean): void =>
  writeFlag(ENABLED_STORAGE_KEY, enabled);

export const readBeaconIntroSeen = (): boolean =>
  readFlag(INTRO_SEEN_STORAGE_KEY);

export const writeBeaconIntroSeen = (): void =>
  writeFlag(INTRO_SEEN_STORAGE_KEY, true);

export const readBeaconTrade = (): BeaconTrade =>
  Option.getOrElse(
    Schema.decodeUnknownOption(StoredTrade)(
      safeLocalStorageGet(TRADE_STORAGE_KEY),
    ),
    (): BeaconTrade => "none",
  );

export const writeBeaconTrade = (trade: BeaconTrade): void => {
  if (trade === "none") safeLocalStorageRemove(TRADE_STORAGE_KEY);
  else safeLocalStorageSet(TRADE_STORAGE_KEY, trade);
};
