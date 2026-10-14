import { createIdFromString } from "@linky-fit/domain";
import {
  NonEmptyString100,
  NonEmptyString1000,
  tableRepository,
  type LinkyDbSchema,
  type LinkyStore,
  type ShardDbError,
  type TableRepository,
} from "@linky-fit/linksync";
import { Effect, Option, Schema } from "effect";
import { CzechIban, type ShopProfile } from "../domain";

export type SettingsRepository = TableRepository<LinkyDbSchema["setting"]>;

/** The account's synced settings: rows of the meta `setting` table. */
export const makeSettingsRepository = (store: LinkyStore): SettingsRepository =>
  tableRepository(store, "meta", "setting");

const SHOP_KEY = "fazole.shop";
// Mirrors linksync's `settingIdFor`, whose keys are Linky's own settings only.
export const shopSettingId = createIdFromString<"Setting">(
  `setting/${SHOP_KEY}`,
);

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

const ShopJson = Schema.fromJsonString(
  Schema.Struct({
    name: ShopName,
    iban: Schema.optionalKey(CzechIban),
    picture: Schema.optionalKey(ShopPicture),
  }),
);

export const readShop = (
  settings: SettingsRepository,
): Effect.Effect<ShopProfile | null> =>
  Effect.map(settings.byId(shopSettingId), (row) =>
    Option.getOrNull(
      Option.map(
        Schema.decodeUnknownOption(ShopJson)(row?.value),
        ({ name, iban, picture }) => ({
          name,
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
  settings.insert({
    id: shopSettingId,
    key: NonEmptyString100.orThrow(SHOP_KEY),
    value: NonEmptyString1000.orThrow(
      Schema.encodeSync(ShopJson)({
        name: shop.name,
        ...(shop.iban === null ? {} : { iban: shop.iban }),
        ...(shop.picture === null ? {} : { picture: shop.picture }),
      }),
    ),
  });
