import { NonEmptyString100, NonEmptyString1000 } from "@linky-fit/domain";
import { Effect, Result } from "effect";
import { ShardDbError } from "../core";
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

  it("reads, writes and removes raw app settings under the shared setting id scheme", () => {
    const { db, store } = linkyStore();
    const settings = makeSettingsRepository(store);
    expect(runNow(settings.getRaw("fazole.shop"))).toBeNull();
    runNow(settings.setRaw("fazole.shop", '{"name":"Kavárna"}'));
    expect(runNow(settings.getRaw("fazole.shop"))).toBe('{"name":"Kavárna"}');
    runNow(settings.setRaw("fazole.shop", '{"name":"Pražírna"}'));
    expect(runNow(settings.getRaw("fazole.shop"))).toBe('{"name":"Pražírna"}');
    expect(runNow(db.readTable("setting"))).toHaveLength(1);
    runNow(settings.removeRaw("fazole.shop"));
    expect(runNow(settings.getRaw("fazole.shop"))).toBeNull();
    // Re-writing after removal revives the row.
    runNow(settings.setRaw("fazole.shop", '{"name":"Zpět"}'));
    expect(runNow(settings.getRaw("fazole.shop"))).toBe('{"name":"Zpět"}');
  });

  it("writes raw settings via a single upsert without read-then-update", () => {
    const { db, store } = linkyStore();
    const settings = makeSettingsRepository(store);
    runNow(settings.setRaw("operator.profile", '{"name":"A"}'));
    const readSpy = vi.spyOn(db, "readTable");
    const mutateSpy = vi.spyOn(db, "mutate");
    runNow(settings.setRaw("operator.profile", '{"name":"B"}'));
    expect(
      readSpy.mock.calls.filter(([table]) => table === "setting"),
    ).toHaveLength(0);
    expect(mutateSpy).toHaveBeenCalledTimes(1);
    expect(mutateSpy.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({ kind: "upsert", table: "setting" }),
    ]);
    expect(runNow(settings.getRaw("operator.profile"))).toBe('{"name":"B"}');
    expect(runNow(db.readTable("setting"))).toHaveLength(1);
  });

  it("defers invalid setting encoding into the Effect as ShardDbError", () => {
    const { store } = linkyStore();
    const settings = makeSettingsRepository(store);
    const write = settings.set("defaultMint", "");
    const outcome = runNow(Effect.result(write));
    expect(Result.isFailure(outcome)).toBe(true);
    if (Result.isFailure(outcome)) {
      expect(outcome.failure).toBeInstanceOf(ShardDbError);
    }
  });
});
