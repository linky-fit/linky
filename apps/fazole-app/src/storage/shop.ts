import {
  makeSettingsRepository,
  type SettingsRepository,
  type ShardDbError,
} from "@linky-fit/linksync";
import { Effect, Option, Schema } from "effect";
import { CzechIban, type ShopProfile } from "../domain";

export { makeSettingsRepository };
export type { SettingsRepository };

export const SHOP_SETTING_KEY = "fazole.shop";

/** What the merchant may name the shop: trimmed, 1 to 100 characters. */
export const ShopName = Schema.String.pipe(
  Schema.check(
    Schema.isTrimmed(),
    Schema.isNonEmpty(),
    Schema.isMaxLength(100),
  ),
);

/** An https URL short enough to fit the setting row next to the name and IBAN. */
export const ShopPicture = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^https:\/\/\S+$/u), Schema.isMaxLength(500)),
);

/**
 * The shop's name and picture as a Nostr profile has them, cut down to what
 * the shop stores: a name too long is shortened, a picture that is not a
 * short https URL is left out.
 */
export const shopFieldsFromProfile = (profile: {
  readonly name: string | null;
  readonly picture: string | null;
}): Pick<ShopProfile, "name" | "picture"> => {
  const name = profile.name?.trim().slice(0, 100).trim() ?? "";
  return {
    name: Schema.is(ShopName)(name) ? name : null,
    picture:
      profile.picture !== null && Schema.is(ShopPicture)(profile.picture)
        ? profile.picture
        : null,
  };
};

const ShopJson = Schema.fromJsonString(
  Schema.Struct({
    name: Schema.optionalKey(ShopName),
    iban: Schema.optionalKey(CzechIban),
    picture: Schema.optionalKey(ShopPicture),
  }),
);

export const readShop = (
  settings: SettingsRepository,
): Effect.Effect<ShopProfile | null> =>
  Effect.map(settings.getRaw(SHOP_SETTING_KEY), (value) =>
    Option.getOrNull(
      Option.map(
        Schema.decodeUnknownOption(ShopJson)(value),
        ({ name, iban, picture }) => ({
          name: name ?? null,
          iban: iban ?? null,
          picture: picture ?? null,
        }),
      ),
    ),
  );

export const saveShop = (
  settings: SettingsRepository,
  shop: ShopProfile,
): Effect.Effect<void, ShardDbError> =>
  settings.setRaw(
    SHOP_SETTING_KEY,
    Schema.encodeSync(ShopJson)({
      ...(shop.name === null ? {} : { name: shop.name }),
      ...(shop.iban === null ? {} : { iban: shop.iban }),
      ...(shop.picture === null ? {} : { picture: shop.picture }),
    }),
  );
