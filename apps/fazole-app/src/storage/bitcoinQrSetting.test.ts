import { NonEmptyString100, NonEmptyString1000 } from "@linky-fit/linksync";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { testStore } from "../services/testing/fakes";
import {
  bitcoinQrSettingId,
  readBitcoinQrMode,
  saveBitcoinQrMode,
} from "./bitcoinQrSetting";
import { makeSettingsRepository } from "./shop";

describe("the Bitcoin QR setting", () => {
  it("is universal until the merchant picks Cashu or Lightning alone, and back", async () => {
    const settings = makeSettingsRepository(testStore());
    expect(await Effect.runPromise(readBitcoinQrMode(settings))).toBe(
      "universal",
    );
    await Effect.runPromise(saveBitcoinQrMode(settings, "lightning"));
    expect(await Effect.runPromise(readBitcoinQrMode(settings))).toBe(
      "lightning",
    );
    await Effect.runPromise(saveBitcoinQrMode(settings, "cashu"));
    expect(await Effect.runPromise(readBitcoinQrMode(settings))).toBe("cashu");
    await Effect.runPromise(saveBitcoinQrMode(settings, "universal"));
    expect(await Effect.runPromise(readBitcoinQrMode(settings))).toBe(
      "universal",
    );
  });

  it("reads the combined mode the first release stored as universal", async () => {
    const settings = makeSettingsRepository(testStore());
    await Effect.runPromise(
      settings.insert({
        id: bitcoinQrSettingId,
        key: NonEmptyString100.orThrow("fazole.bitcoinQr"),
        value: NonEmptyString1000.orThrow("combined"),
      }),
    );
    expect(await Effect.runPromise(readBitcoinQrMode(settings))).toBe(
      "universal",
    );
  });
});
