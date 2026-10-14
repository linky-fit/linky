import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { testStore } from "../services/testing/fakes";
import { makeSettingsRepository } from "./shop";
import { readOfferTips, saveOfferTips } from "./tipSetting";

describe("the tip setting", () => {
  it("offers tips until the merchant turns them off, and back on", async () => {
    const settings = makeSettingsRepository(testStore());
    expect(await Effect.runPromise(readOfferTips(settings))).toBe(true);
    await Effect.runPromise(saveOfferTips(settings, false));
    expect(await Effect.runPromise(readOfferTips(settings))).toBe(false);
    await Effect.runPromise(saveOfferTips(settings, true));
    expect(await Effect.runPromise(readOfferTips(settings))).toBe(true);
  });
});
