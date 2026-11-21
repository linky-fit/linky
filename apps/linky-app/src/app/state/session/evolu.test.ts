// @vitest-environment jsdom
import { createEvoluDeps, createRun } from "@evolu/web";
import { Effect } from "effect";
import { AtomRegistry } from "effect/reactivity";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeWebPlatformPorts } from "../../../platform/ports.web";
import {
  makeTestAppRegistry,
  signedInSession,
} from "../../../testUtils/appRegistry";
import { makeTestLinkyStore } from "../../../testUtils/linkyStore";
import { AppMnemonicUnreadable, evoluAtom, openSessionEvolu } from "./evolu";
import { sessionAtom } from "./session";
import { linkyStoreAtom, SessionSignedOut } from "./store";

const openLinkyEvolu = vi.hoisted(() => vi.fn(() => Promise.resolve({})));
const openLinkyStore = vi.hoisted(() => vi.fn());
vi.mock("@linky-fit/linksync/evolu", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@linky-fit/linksync/evolu")>()),
  openLinkyEvolu,
  openLinkyStore,
}));

const run = createRun(createEvoluDeps());

const recommended = [
  "wss://evolu.eu.freedomrelay.dev",
  "wss://evolu.linky.fit",
];
const free = "wss://free.evoluhq.com";
const custom = "wss://sync.example.com";
const userKey = "linky.evoluServers.user.v1";

/** Boots the way main.tsx does for a signed-in session and returns the registry. */
const boot = async (
  appMnemonic: string | null = null,
  evoluRelayDefaults: string[] = [],
) => {
  const ports = makeWebPlatformPorts();
  const registry = makeTestAppRegistry({
    ports: { ...ports, config: { ...ports.config, evoluRelayDefaults } },
    session: signedInSession({ appMnemonic }),
  });
  await openSessionEvolu(registry, run, { memoryOnly: false });
  return registry;
};

const expectTransports = (relayUrls: string[]) =>
  expect(openLinkyEvolu).toHaveBeenCalledWith(
    run,
    expect.objectContaining({ relayUrls }),
  );

beforeEach(() => {
  localStorage.clear();
  openLinkyEvolu.mockClear();
  openLinkyStore.mockReset();
});

describe("Evolu relay upgrade to recommended relays", () => {
  it("keeps the untouched old defaults that are not recommended as the user's", async () => {
    await boot("seed");
    expect(localStorage.getItem(userKey)).toBe(JSON.stringify([free]));
    expectTransports([...recommended, free]);
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
  await boot("seed", ["ws://localhost:4001"]);
  expect(localStorage.getItem(userKey)).toBe("[]");
  expectTransports(["ws://localhost:4001"]);
});

describe("session database", () => {
  it("opens nothing while signed out, even after the session changes", async () => {
    const registry = makeTestAppRegistry({ session: { _tag: "SignedOut" } });
    expect(registry.get(evoluAtom)).toBeNull();
    registry.set(sessionAtom, signedInSession());
    expect(registry.get(evoluAtom)).toBeNull();
    expect(openLinkyEvolu).not.toHaveBeenCalled();
    const failure = await Effect.runPromise(
      Effect.flip(AtomRegistry.getResult(registry, linkyStoreAtom)),
    );
    expect(failure).toBeInstanceOf(SessionSignedOut);
  });

  it("opens the database once per page load and its store over it", async () => {
    const { store } = makeTestLinkyStore();
    openLinkyStore.mockResolvedValue(store);
    const registry = await boot();
    const opened = registry.get(evoluAtom);
    registry.set(sessionAtom, signedInSession({ nsec: "nsec1other" }));
    expect(registry.get(evoluAtom)).toBe(opened);
    expect(openLinkyEvolu).toHaveBeenCalledTimes(1);

    await expect(
      Effect.runPromise(AtomRegistry.getResult(registry, linkyStoreAtom)),
    ).resolves.toBe(store);
    expect(openLinkyStore).toHaveBeenCalledWith(
      opened?.evolu,
      expect.objectContaining({
        syncState: run.deps.syncState,
        hasEvoluRelay: true,
        memoryOnly: false,
      }),
    );
  });

  it("propagates memoryOnly and derives hasEvoluRelay from valid WebSocket transports", async () => {
    const { store } = makeTestLinkyStore();
    openLinkyStore.mockResolvedValue(store);
    const ports = makeWebPlatformPorts();
    const registry = makeTestAppRegistry({
      ports: {
        ...ports,
        config: { ...ports.config, evoluRelayDefaults: ["not-a-ws-url"] },
      },
      session: signedInSession(),
    });
    const opened = await openSessionEvolu(registry, run, { memoryOnly: true });
    expect(opened.hasEvoluRelay).toBe(false);
    expect(opened.memoryOnly).toBe(true);
    await Effect.runPromise(AtomRegistry.getResult(registry, linkyStoreAtom));
    expect(openLinkyStore).toHaveBeenCalledWith(
      opened.evolu,
      expect.objectContaining({
        hasEvoluRelay: false,
        memoryOnly: true,
      }),
    );
  });

  it("opens nothing when secure storage could not read the app mnemonic", async () => {
    const registry = makeTestAppRegistry({
      session: {
        _tag: "SignedIn",
        secrets: signedInSession().secrets,
        degraded: true,
        cause: "timed out",
        unreadable: new Set(["appMnemonic"]),
      },
    });
    await expect(
      openSessionEvolu(registry, run, { memoryOnly: false }),
    ).rejects.toBeInstanceOf(AppMnemonicUnreadable);
    expect(openLinkyEvolu).not.toHaveBeenCalled();
    expect(registry.get(evoluAtom)).toBeNull();
  });
});
