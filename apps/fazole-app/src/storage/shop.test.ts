import { NonEmptyString100, NonEmptyString1000 } from "@linky-fit/linksync";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { CzechIban } from "../domain";
import { testStore } from "../services/testing/fakes";
import {
  makeSettingsRepository,
  readShop,
  saveShop,
  shopSettingId,
} from "./shop";

describe("the shop profile", () => {
  it("is absent until saved, then reads back with or without a bank account", async () => {
    const settings = makeSettingsRepository(testStore());
    expect(await Effect.runPromise(readShop(settings))).toBeNull();
    const shop = {
      name: "Kavárna U Fazole",
      iban: CzechIban.make("CZ6508000000192000145399"),
      picture: null,
    };
    await Effect.runPromise(saveShop(settings, shop));
    expect(await Effect.runPromise(readShop(settings))).toEqual(shop);
    await Effect.runPromise(saveShop(settings, { ...shop, iban: null }));
    expect(await Effect.runPromise(readShop(settings))).toEqual({
      ...shop,
      iban: null,
    });
  });

  it("keeps a picture and drops it again", async () => {
    const settings = makeSettingsRepository(testStore());
    const shop = {
      name: "Kavárna",
      iban: null,
      picture: "https://blossom.primal.net/ab12.webp",
    };
    await Effect.runPromise(saveShop(settings, shop));
    expect(await Effect.runPromise(readShop(settings))).toEqual(shop);
    await Effect.runPromise(saveShop(settings, { ...shop, picture: null }));
    expect(await Effect.runPromise(readShop(settings))).toEqual({
      ...shop,
      picture: null,
    });
  });

  it("reads a profile saved before shops had pictures", async () => {
    const settings = makeSettingsRepository(testStore());
    await Effect.runPromise(
      settings.insert({
        id: shopSettingId,
        key: NonEmptyString100.orThrow("fazole.shop"),
        value: NonEmptyString1000.orThrow('{"name":"Kavárna"}'),
      }),
    );
    expect(await Effect.runPromise(readShop(settings))).toEqual({
      name: "Kavárna",
      iban: null,
      picture: null,
    });
  });
});
