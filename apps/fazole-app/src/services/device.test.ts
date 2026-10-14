import { KeyValueStore, makeInMemoryKeyValueStore } from "@linky-fit/linkshu";
import { Effect, Layer, Result } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRecoverySeed } from "../storage/account";
import type { Device, DevicePlatform } from "./device";
import { createDevice } from "./device";
import {
  memoryKv,
  sharedOutboxStore,
  testConfig,
  testStore,
} from "./testing/fakes";

const signedIn = (device: Device) => {
  const session = device.session();
  if (session._tag !== "SignedIn") throw new Error(`${session._tag}`);
  return session;
};

const fakePlatform = (kv = memoryKv()) => {
  const offered: string[] = [];
  let reloads = 0;
  const linkshuKv = makeInMemoryKeyValueStore();
  const platform: DevicePlatform = {
    kv,
    openStore: async () => testStore(),
    servicePorts: () => ({
      outboxStore: sharedOutboxStore(),
      keyValueStore: Layer.succeed(KeyValueStore, linkshuKv),
    }),
    saveRecoverySeed: (_account, shopName) => void offered.push(shopName),
    reload: () => {
      reloads += 1;
    },
    resetDevice: () => {},
  };
  return { platform, kv, linkshuKv, offered, reloads: () => reloads };
};

const opened: Device[] = [];
const open = (platform: DevicePlatform) => {
  const device = createDevice(testConfig, platform);
  opened.push(device);
  return device;
};

afterEach(async () => {
  for (const device of opened.splice(0)) {
    const session = device.session();
    if (session._tag === "SignedIn") await session.services.dispose();
  }
  vi.restoreAllMocks();
});

describe("a device", () => {
  it("creates an account, saves its shop and offers the seed to the password manager", async () => {
    // No relays are configured, so the inbox reports it cannot open.
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { platform, kv, offered } = fakePlatform();
    const device = open(platform);
    expect(device.session()._tag).toBe("SignedOut");
    device.prepareAccount();
    await device.createAccount({ name: "Kavárna", iban: null, picture: null });
    const session = signedIn(device);
    expect(session.restored).toBe(false);
    expect(await session.services.shop.load()).toEqual({
      name: "Kavárna",
      iban: null,
      picture: null,
    });
    expect(offered).toEqual(["Kavárna"]);
    expect(kv.entries.has("linky.fazole.account")).toBe(true);
  });

  it("opens the stored account on the next start", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const first = fakePlatform();
    const device = open(first.platform);
    await device.createAccount({ name: "Kavárna", iban: null, picture: null });
    const { npub } = signedIn(device).services.account;
    const restarted = open(fakePlatform(first.kv).platform);
    await vi.waitFor(() =>
      expect(signedIn(restarted).services.account.npub).toBe(npub),
    );
  });

  it("restores an account and holds its writes until the account's data arrives", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { platform, kv } = fakePlatform();
    const device = open(platform);
    const seed = await Effect.runPromise(createRecoverySeed);
    expect(Result.isSuccess(await device.restoreAccount(seed))).toBe(true);
    expect(signedIn(device).restored).toBe(true);
    expect(
      [...kv.entries.keys()].some((key) =>
        key.startsWith("linky.shards.awaitingFirstHydration."),
      ),
    ).toBe(true);
  });

  it("reloads into a restored account when another one is open", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fake = fakePlatform();
    const device = open(fake.platform);
    await device.createAccount({ name: "Kavárna", iban: null, picture: null });
    const { npub } = signedIn(device).services.account;
    const seed = await Effect.runPromise(createRecoverySeed);
    await device.restoreAccount(seed);
    expect(fake.reloads()).toBe(1);
    expect(signedIn(device).services.account.npub).toBe(npub);
  });

  it("forgets the replaced seed's wallet counters before reloading into another account", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fake = fakePlatform();
    const device = open(fake.platform);
    await device.createAccount({ name: "Kavárna", iban: null, picture: null });
    const counter = "linkshu.detCounter.https%3A%2F%2Fmint.example.sat.00ff";
    const seenMint = "linkshu.seenMints.https%3A%2F%2Fmint.example";
    await Effect.runPromise(fake.linkshuKv.set(counter, "42"));
    await Effect.runPromise(fake.linkshuKv.set(seenMint, "42"));
    await device.restoreAccount(await Effect.runPromise(createRecoverySeed));
    expect(await Effect.runPromise(fake.linkshuKv.get(counter))).toBeNull();
    expect(await Effect.runPromise(fake.linkshuKv.get(seenMint))).toBe("42");
    expect(fake.reloads()).toBe(1);
  });

  it("refuses a mistyped recovery seed and stays signed out", async () => {
    const { platform } = fakePlatform();
    const device = open(platform);
    const restored = await device.restoreAccount("kavárna u fazole");
    expect(Result.isFailure(restored)).toBe(true);
    expect(device.session()._tag).toBe("SignedOut");
  });
});
