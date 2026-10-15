// @vitest-environment jsdom
import { Effect } from "effect";
import { AtomRegistry } from "effect/reactivity";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  makeTestAppRegistry,
  signedInSession,
} from "../../../testUtils/appRegistry";
import { makeTestLinkyStore } from "../../../testUtils/linkyStore";
import { CASHU_ONBOARDING_SET_MAIN_MINT_STORAGE_KEY } from "../../../utils/constants";
import {
  CASHU_DEFAULT_MINT_OVERRIDE_STORAGE_KEY,
  MAIN_MINT_URL,
  normalizeMintUrl,
} from "../../../utils/mint";
import { appOwnerIdAtom, settingsRepositoryAtom } from "../session/store";
import {
  defaultMintAtom,
  defaultMintChoiceAtom,
  defaultMintCommandsAtom,
} from "./defaultMint";

vi.mock("@evolu/common", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@evolu/common")>()),
  createEvolu: () => () => ({}),
}));
const openLinkyStore = vi.hoisted(() => vi.fn());
vi.mock("@linky-fit/linksync/evolu", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@linky-fit/linksync/evolu")>()),
  openLinkyStore,
}));

const result = <A, E>(
  registry: AtomRegistry.AtomRegistry,
  atom: Parameters<typeof AtomRegistry.getResult<A, E>>[1],
) => Effect.runPromise(AtomRegistry.getResult(registry, atom));

const boot = async () => {
  openLinkyStore.mockResolvedValue(makeTestLinkyStore().store);
  const registry = makeTestAppRegistry({ session: signedInSession() });
  const ownerId = await result(registry, appOwnerIdAtom);
  const settings = await result(registry, settingsRepositoryAtom);
  return {
    commands: await result(registry, defaultMintCommandsAtom),
    overrideKey: `${CASHU_DEFAULT_MINT_OVERRIDE_STORAGE_KEY}.${ownerId}`,
    registry,
    synced: () => Effect.runPromise(settings.get("defaultMint")),
  };
};

afterEach(() => localStorage.clear());

describe("default mint", () => {
  it("stores the user's choice on the device and in the synced setting", async () => {
    const { commands, overrideKey, registry, synced } = await boot();

    expect(await commands.setDefaultMint("https://Kashu.me/")).toEqual({
      ok: true,
    });

    expect(registry.get(defaultMintChoiceAtom)).toEqual({
      mint: "https://kashu.me",
      chosen: true,
    });
    expect(registry.get(defaultMintAtom)).toBe("https://kashu.me");
    expect(localStorage.getItem(overrideKey)).toBe("https://kashu.me");
    expect(await synced()).toBe("https://kashu.me");
  });

  it("takes over a choice synced from another device", async () => {
    const { commands, overrideKey, registry } = await boot();

    commands.adoptSyncedDefaultMint("https://cashu.cz");

    expect(registry.get(defaultMintChoiceAtom)).toEqual({
      mint: "https://cashu.cz",
      chosen: true,
    });
    expect(localStorage.getItem(overrideKey)).toBe("https://cashu.cz");
  });

  it("uses npub.cash's mint only while nothing is chosen", async () => {
    const { commands, registry } = await boot();

    commands.suggestDefaultMint("https://npub.example");
    expect(registry.get(defaultMintChoiceAtom)).toEqual({
      mint: "https://npub.example",
      chosen: false,
    });

    await commands.setDefaultMint("https://kashu.me");
    commands.suggestDefaultMint("https://other.example");
    expect(registry.get(defaultMintChoiceAtom).mint).toBe("https://kashu.me");
  });

  it("seeds a new account's default mint once", async () => {
    const { commands, registry, synced } = await boot();
    localStorage.setItem(CASHU_ONBOARDING_SET_MAIN_MINT_STORAGE_KEY, "1");

    await commands.seedOnboardingDefaultMint();
    await commands.setDefaultMint("https://kashu.me");
    await commands.seedOnboardingDefaultMint();

    expect(
      localStorage.getItem(CASHU_ONBOARDING_SET_MAIN_MINT_STORAGE_KEY),
    ).toBeNull();
    expect(registry.get(defaultMintChoiceAtom).mint).toBe("https://kashu.me");
    expect(await synced()).toBe("https://kashu.me");
  });

  it("seeds the production default mint on onboarding", async () => {
    const { commands, registry } = await boot();
    localStorage.setItem(CASHU_ONBOARDING_SET_MAIN_MINT_STORAGE_KEY, "1");

    await commands.seedOnboardingDefaultMint();

    expect(registry.get(defaultMintChoiceAtom)).toEqual({
      mint: normalizeMintUrl(MAIN_MINT_URL),
      chosen: true,
    });
  });
});
