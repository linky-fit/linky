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
    // Unix seconds of the merchant's last edit; releases before it ignore it.
    editedAt: Schema.optionalKey(Schema.Number),
  }),
);
const decodeShop = Schema.decodeUnknownOption(ShopJson);

export const readShop = (
  settings: SettingsRepository,
): Effect.Effect<ShopProfile | null> =>
  Effect.map(settings.getRaw(SHOP_SETTING_KEY), (value) =>
    Option.getOrNull(
      Option.map(decodeShop(value), ({ name, iban, picture }) => ({
        name: name ?? null,
        iban: iban ?? null,
        picture: picture ?? null,
      })),
    ),
  );

/** When the merchant last edited the shop here or on another terminal, or `null` when it came from the profile. */
export const readShopEditedAt = (
  settings: SettingsRepository,
): Effect.Effect<number | null> =>
  Effect.map(settings.getRaw(SHOP_SETTING_KEY), (value) =>
    Option.getOrNull(
      Option.flatMapNullishOr(decodeShop(value), ({ editedAt }) => editedAt),
    ),
  );

/** Stores the shop; `editedAt` marks a merchant's edit the Nostr profile may not have yet. */
export const saveShop = (
  settings: SettingsRepository,
  shop: ShopProfile,
  editedAt: number | null,
): Effect.Effect<void, ShardDbError> =>
  settings.setRaw(
    SHOP_SETTING_KEY,
    Schema.encodeSync(ShopJson)({
      ...(shop.name === null ? {} : { name: shop.name }),
      ...(shop.iban === null ? {} : { iban: shop.iban }),
      ...(shop.picture === null ? {} : { picture: shop.picture }),
      ...(editedAt === null ? {} : { editedAt }),
    }),
  );
