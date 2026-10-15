import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { testStore } from "../services/testing/fakes";
import { readLightningOnlyQr, saveLightningOnlyQr } from "./bitcoinQrSetting";
import { makeSettingsRepository } from "./shop";

describe("the Bitcoin QR setting", () => {
  it("combines Lightning and Cashu until the merchant picks Lightning only, and back", async () => {
    const settings = makeSettingsRepository(testStore());
    expect(await Effect.runPromise(readLightningOnlyQr(settings))).toBe(false);
    await Effect.runPromise(saveLightningOnlyQr(settings, true));
    expect(await Effect.runPromise(readLightningOnlyQr(settings))).toBe(true);
    await Effect.runPromise(saveLightningOnlyQr(settings, false));
    expect(await Effect.runPromise(readLightningOnlyQr(settings))).toBe(false);
  });
});
