import { linkyStore, runNow } from "../testing/linky";
import { makeSettingsRepository } from "./settings";

describe("settings repository", () => {
  it("stores one value per key in the app owner", () => {
    const { db, store, appOwner } = linkyStore();
    const settings = makeSettingsRepository(store);
    expect(runNow(settings.get("onboarding"))).toBeNull();
    runNow(settings.set("onboarding", "dismissed"));
    runNow(settings.set("onboarding", "shown"));
    expect(runNow(settings.get("onboarding"))).toBe("shown");
    const rows = runNow(db.readTable("setting"));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.ownerId).toBe(appOwner.id);
    runNow(settings.remove("onboarding"));
    runNow(settings.remove("never-set"));
    expect(runNow(settings.get("onboarding"))).toBeNull();
  });
});
