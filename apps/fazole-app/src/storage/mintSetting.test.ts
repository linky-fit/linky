import { NonEmptyString100, NonEmptyString1000 } from "@linky-fit/linksync";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { testStore } from "../services/testing/fakes";
import {
  mintSettingId,
  offeredMints,
  parseMintUrlInput,
  readMintUrl,
  saveMintUrl,
} from "./mintSetting";
import { makeSettingsRepository } from "./shop";

describe("the mint setting", () => {
  it("is the config's mint until the merchant picks another", async () => {
    const settings = makeSettingsRepository(testStore());
    expect(
      await Effect.runPromise(readMintUrl(settings, "https://cashu.cz")),
    ).toBe("https://cashu.cz");
    await Effect.runPromise(saveMintUrl(settings, "https://kashu.me"));
    expect(
      await Effect.runPromise(readMintUrl(settings, "https://cashu.cz")),
    ).toBe("https://kashu.me");
  });

  it("falls back to the config's mint when the stored value is no mint", async () => {
    const settings = makeSettingsRepository(testStore());
    await Effect.runPromise(
      settings.insert({
        id: mintSettingId,
        key: NonEmptyString100.orThrow("fazole.mintUrl"),
        value: NonEmptyString1000.orThrow("not a url"),
      }),
    );
    expect(
      await Effect.runPromise(readMintUrl(settings, "https://cashu.cz")),
    ).toBe("https://cashu.cz");
  });
});

describe("parseMintUrlInput", () => {
  it("takes a mint URL or a bare host, and nothing else", () => {
    expect(parseMintUrlInput(" kashu.me ")).toBe("https://kashu.me");
    expect(parseMintUrlInput("https://mint.minibits.cash/Bitcoin/")).toBe(
      "https://mint.minibits.cash/Bitcoin",
    );
    expect(parseMintUrlInput("http://localhost:3338")).toBe(
      "http://localhost:3338",
    );
    expect(parseMintUrlInput("")).toBeNull();
    expect(parseMintUrlInput("mint")).toBeNull();
    expect(parseMintUrlInput("not a url")).toBeNull();
  });
});

describe("offeredMints", () => {
  it("lists the presets, the selected mint and the funded ones once each, without test mints", () => {
    expect(
      offeredMints({
        defaultMintUrl: "https://cashu.cz",
        selectedMintUrl: "https://mint.example",
        fundedMints: ["https://kashu.me", "http://localhost:3338"],
      }),
    ).toEqual([
      "https://cashu.cz",
      "https://mint.minibits.cash/Bitcoin",
      "https://kashu.me",
      "https://cashu.21m.lol",
      "https://mint.example",
    ]);
  });

  it("offers only the development mint when the config points at one", () => {
    expect(
      offeredMints({
        defaultMintUrl: "http://localhost:3338",
        selectedMintUrl: "http://localhost:3338",
        fundedMints: [],
      }),
    ).toEqual(["http://localhost:3338"]);
  });
});
