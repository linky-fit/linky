import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { INITIAL_MNEMONIC_STORAGE_KEY } from "./mnemonic";

const createDatabase = vi.hoisted(() => vi.fn(() => ({})));
vi.mock("@evolu/common", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@evolu/common")>()),
  createEvolu: () => createDatabase,
}));

const recommended = [
  "wss://evolu.eu.freedomrelay.dev",
  "wss://evolu.linky.fit",
];
const free = "wss://free.evoluhq.com";
const custom = "wss://sync.example.com";
const userKey = "linky.evoluServers.user.v1";
const legacyKey = "linky.evoluServers.v1";
const legacyRemovedKey = "linky.evoluServers.defaultRemoved.v1";
const disabledKey = "linky.evoluServers.disabled.v1";

const boot = async () => {
  vi.resetModules();
  createDatabase.mockClear();
  await import("./evolu");
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
  vi.stubEnv("VITE_EVOLU_SERVER_URLS", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("Evolu relay upgrade to recommended relays", () => {
  it("keeps the untouched old defaults that are not recommended as the user's", async () => {
    localStorage.setItem(INITIAL_MNEMONIC_STORAGE_KEY, "seed");
    await boot();
    expect(localStorage.getItem(userKey)).toBe(JSON.stringify([free]));
    expectTransports([...recommended, free]);
  });

  it("keeps a customized selection without the recommended relays", async () => {
    localStorage.setItem(legacyKey, JSON.stringify([custom, recommended[1]]));
    localStorage.setItem(legacyRemovedKey, "true");
    await boot();
    expect(localStorage.getItem(userKey)).toBe(JSON.stringify([custom]));
    expectTransports([...recommended, custom]);
  });

  it("adds nothing of the user's on a fresh install", async () => {
    await boot();
    expect(localStorage.getItem(userKey)).toBe("[]");
    expectTransports(recommended);
  });

  it("migrates once and keeps disabled relays offline", async () => {
    localStorage.setItem(legacyKey, JSON.stringify([custom]));
    localStorage.setItem(legacyRemovedKey, "true");
    localStorage.setItem(disabledKey, JSON.stringify([recommended[0]]));
    await boot();
    localStorage.setItem(legacyKey, JSON.stringify([free]));
    await boot();
    expectTransports([recommended[1], custom]);
  });
});

it("boots with the cached recommendation from the endpoint", async () => {
  localStorage.setItem(userKey, JSON.stringify([custom]));
  localStorage.setItem(
    "linky.recommendedRelays.v1",
    JSON.stringify({
      nostr: [],
      evolu: ["wss://evolu.example.com"],
      retiredNostr: [],
    }),
  );
  await boot();
  expectTransports(["wss://evolu.example.com", custom]);
});

it("keeps environment overrides isolated from production", async () => {
  vi.stubEnv("VITE_EVOLU_SERVER_URLS", "ws://localhost:4001");
  localStorage.setItem(INITIAL_MNEMONIC_STORAGE_KEY, "seed");
  await boot();
  expect(localStorage.getItem(userKey)).toBe("[]");
  expectTransports(["ws://localhost:4001"]);
});
