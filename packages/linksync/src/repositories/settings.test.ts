import { NonEmptyString100, NonEmptyString1000 } from "@evolu/common";
import { settingIdFor } from "../model/ids";
import { linkyStore, runNow } from "../testing/linky";
import { makeSettingsRepository } from "./settings";

describe("settings repository", () => {
  it("stores one value per key in the app owner", () => {
    const { db, store, appOwner } = linkyStore();
    const settings = makeSettingsRepository(store);
    expect(runNow(settings.get("defaultMint"))).toBeNull();
    runNow(settings.set("defaultMint", "https://a.example"));
    runNow(settings.set("defaultMint", "https://b.example"));
    expect(runNow(settings.get("defaultMint"))).toBe("https://b.example");
    const rows = runNow(db.readTable("setting"));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.ownerId).toBe(appOwner.id);
    runNow(settings.remove("defaultMint"));
    runNow(settings.remove("allowTestMints"));
    expect(runNow(settings.get("defaultMint"))).toBeNull();
  });

  it("stores values in their synced text encoding", () => {
    const { db, store } = linkyStore();
    const settings = makeSettingsRepository(store);
    runNow(settings.set("allowTestMints", false));
    runNow(settings.set("displayCurrencies", ["CZK"]));
    const values = runNow(db.readTable("setting")).map((row) => row.value);
    expect(values).toEqual(expect.arrayContaining(["0", '["CZK"]']));
    expect(runNow(settings.get("allowTestMints"))).toBe(false);
    expect(runNow(settings.get("displayCurrencies"))).toEqual(["CZK"]);
  });

  it("reads a value it cannot decode as absent", () => {
    const { store } = linkyStore();
    runNow(
      store.insert("meta", "setting", {
        id: settingIdFor("allowTestMints"),
        key: NonEmptyString100.orThrow("allowTestMints"),
        value: NonEmptyString1000.orThrow("yes"),
      }),
    );
    expect(
      runNow(makeSettingsRepository(store).get("allowTestMints")),
    ).toBeNull();
  });

  it("keeps the bolt card Send switch off until a device sets it", () => {
    const { db, store } = linkyStore();
    const settings = makeSettingsRepository(store);
    expect(runNow(settings.get("boltCard.armOnSend"))).toBeNull();
    runNow(settings.set("boltCard.armOnSend", true));
    expect(runNow(settings.get("boltCard.armOnSend"))).toBe(true);
    expect(runNow(db.readTable("setting")).map((row) => row.value)).toEqual([
      "1",
    ]);
  });
});
