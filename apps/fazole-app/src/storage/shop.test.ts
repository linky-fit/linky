import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { CzechIban } from "../domain";
import { testStore } from "../services/testing/fakes";
import { makeSettingsRepository, readShop, saveShop } from "./shop";

describe("the shop profile", () => {
  it("is absent until saved, then reads back with or without a bank account", async () => {
    const settings = makeSettingsRepository(testStore());
    expect(await Effect.runPromise(readShop(settings))).toBeNull();
    const shop = {
      name: "Kavárna U Fazole",
      iban: CzechIban.make("CZ6508000000192000145399"),
    };
    await Effect.runPromise(saveShop(settings, shop));
    expect(await Effect.runPromise(readShop(settings))).toEqual(shop);
    await Effect.runPromise(saveShop(settings, { ...shop, iban: null }));
    expect(await Effect.runPromise(readShop(settings))).toEqual({
      ...shop,
      iban: null,
    });
  });
});
