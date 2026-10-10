// @vitest-environment jsdom
import { Effect } from "effect";
import { AtomRegistry } from "effect/reactivity";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeWebPlatformPorts } from "../../../platform/ports.web";
import {
  makeTestAppRegistry,
  signedInSession,
} from "../../../testUtils/appRegistry";
import { makeTestLinkyStore } from "../../../testUtils/linkyStore";
import { evoluAtom } from "./evolu";
import { sessionAtom } from "./session";
import { linkyStoreAtom, SessionSignedOut } from "./store";

const createDatabase = vi.hoisted(() => vi.fn(() => ({})));
vi.mock("@evolu/common", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@evolu/common")>()),
  createEvolu: () => createDatabase,
}));
const openLinkyStore = vi.hoisted(() => vi.fn());
vi.mock("@linky-fit/linksync/evolu", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@linky-fit/linksync/evolu")>()),
  openLinkyStore,
}));

const recommended = [
  "wss://evolu.eu.freedomrelay.dev",
  "wss://evolu.linky.fit",
];
const free = "wss://free.evoluhq.com";
const custom = "wss://sync.example.com";
const userKey = "linky.evoluServers.user.v1";

/** Boots the way main.tsx does for a signed-in session and returns the registry. */
const boot = (appMnemonic: string | null = null) => {
  const registry = makeTestAppRegistry({
    ports: makeWebPlatformPorts(),
    session: signedInSession({ appMnemonic }),
  });
  registry.get(evoluAtom);
  return registry;
};

const expectTransports = (urls: string[]) =>
  expect(createDatabase).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      transports: urls.map((url) => ({ type: "WebSocket", url })),
    }),
  );

beforeEach(() => {
  localStorage.clear();
  createDatabase.mockClear();
  openLinkyStore.mockReset();
  vi.stubEnv("VITE_EVOLU_SERVER_URLS", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("Evolu relay upgrade to recommended relays", () => {
  it("keeps the untouched old defaults that are not recommended as the user's", () => {
    boot("seed");
    expect(localStorage.getItem(userKey)).toBe(JSON.stringify([free]));
    expectTransports([...recommended, free]);
  });
});

it("boots with the cached recommendation from the endpoint", () => {
  localStorage.setItem(userKey, JSON.stringify([custom]));
  localStorage.setItem(
    "linky.recommendedRelays.v1",
    JSON.stringify({
      nostr: [],
      evolu: ["wss://evolu.example.com"],
      retiredNostr: [],
    }),
  );
  boot();
  expectTransports(["wss://evolu.example.com", custom]);
});

it("keeps environment overrides isolated from production", () => {
  vi.stubEnv("VITE_EVOLU_SERVER_URLS", "ws://localhost:4001");
  boot("seed");
  expect(localStorage.getItem(userKey)).toBe("[]");
  expectTransports(["ws://localhost:4001"]);
});

describe("session database", () => {
  it("opens nothing while signed out, even after the session changes", async () => {
    const registry = makeTestAppRegistry({
      session: { _tag: "SignedOut" },
      evoluPlatform: null,
    });
    expect(registry.get(evoluAtom)).toBeNull();
    registry.set(sessionAtom, signedInSession());
    expect(registry.get(evoluAtom)).toBeNull();
    expect(createDatabase).not.toHaveBeenCalled();
    const failure = await Effect.runPromise(
      Effect.flip(AtomRegistry.getResult(registry, linkyStoreAtom)),
    );
    expect(failure).toBeInstanceOf(SessionSignedOut);
  });

  it("opens the database once per page load and its store over it", async () => {
    const { store } = makeTestLinkyStore();
    openLinkyStore.mockResolvedValue(store);
    const registry = boot();
    const opened = registry.get(evoluAtom);
    registry.set(sessionAtom, signedInSession({ nsec: "nsec1other" }));
    expect(registry.get(evoluAtom)).toBe(opened);
    expect(createDatabase).toHaveBeenCalledTimes(1);

    await expect(
      Effect.runPromise(AtomRegistry.getResult(registry, linkyStoreAtom)),
    ).resolves.toBe(store);
    expect(openLinkyStore).toHaveBeenCalledWith(
      opened?.evolu,
      opened?.ownerSync,
      expect.objectContaining({ hasEvoluRelay: true }),
    );
  });
});
