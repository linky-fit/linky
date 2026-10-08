import { derivePubkey, NostrSecretKey } from "@linky-fit/linkstr";
import { createIdFromString } from "@linky-fit/linksync";
import type { BeaconPeers } from "./beaconStore";
import { describe, expect, it, vi } from "vitest";

const plugin = vi.hoisted(() => {
  const calls: Array<Array<string | object>> = [];
  const listeners = new Map<string, (data: unknown) => void>();
  const state = { permission: "granted", requestFails: false };
  const record =
    (name: string) =>
    async (...args: object[]) => {
      calls.push([name, ...args]);
      return {};
    };
  return {
    calls,
    state,
    emit: (event: string, data: unknown) => listeners.get(event)?.(data),
    LinkyBeacon: {
      addListener: async (event: string, listener: (data: unknown) => void) => {
        listeners.set(event, listener);
        return { remove: async () => {} };
      },
      getPermissionState: async () => ({ state: state.permission }),
      requestPermissions: async () => {
        calls.push(["requestPermissions"]);
        if (state.requestFails) throw new Error("refused");
        return {};
      },
      setIdentity: record("setIdentity"),
      setKeys: record("setKeys"),
      setTrade: record("setTrade"),
      start: record("start"),
      stop: record("stop"),
    },
  };
});

vi.mock("@capacitor/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@capacitor/core")>();
  return {
    ...actual,
    Capacitor: {
      ...actual.Capacitor,
      isPluginAvailable: (name: string) => name === "LinkyBeacon",
    },
    registerPlugin: (name: string) =>
      name === "LinkyBeacon" ? plugin.LinkyBeacon : actual.registerPlugin(name),
  };
});

vi.mock("../../platform/runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../platform/runtime")>()),
  getPlatformTarget: () => "ios",
}));

const {
  getBeaconSnapshot,
  requestBeaconPermissions,
  setBeaconEnabled,
  setBeaconKeyTable,
  setBeaconPeers,
} = await import("./beaconStore");

const pubkeyOf = (fill: number) =>
  derivePubkey(NostrSecretKey.make(new Uint8Array(32).fill(fill)));
const [alice, bob, carol] = [1, 2, 3].map(pubkeyOf);
const aliceId = createIdFromString<"Contact">("alice");
const peers: BeaconPeers = {
  contactIdByPubkey: new Map([[alice, aliceId]]),
  hidden: new Set(),
};
const key = {
  pubkey: alice,
  beaconKeyHex: "11".repeat(32),
  priority: 0,
  name: "Alice",
};

describe("beacon store on iOS", () => {
  it("takes the permission the plugin reports at launch", async () => {
    await vi.waitFor(() =>
      expect(getBeaconSnapshot().permission).toBe("granted"),
    );
  });

  it("pushes identity, keys and trade to the plugin before starting it", async () => {
    setBeaconPeers({ supported: true, peers, ownPubkey: carol });
    setBeaconEnabled(true);
    setBeaconKeyTable([key]);

    expect(plugin.calls).toEqual([
      ["setIdentity", { pubkey: carol }],
      ["setKeys", { keys: [key] }],
      ["setTrade", { trade: "none" }],
      ["start"],
    ]);

    setBeaconEnabled(false);
    expect(plugin.calls.at(-1)).toEqual(["stop"]);
  });

  it("mirrors the plugin's status, nearby and conversation events", () => {
    plugin.emit("status", {
      running: true,
      bluetoothOn: false,
      advertising: false,
      error: null,
    });
    plugin.emit("nearby", {
      contacts: [{ pubkey: alice, state: "sell", lastSeenMs: 1 }],
    });
    plugin.emit("identities", { pubkeys: [bob] });
    plugin.emit("openConversation", { pubkey: alice });

    const snapshot = getBeaconSnapshot();
    expect(snapshot.status.bluetoothOn).toBe(false);
    expect(snapshot.nearbyContacts).toEqual([
      { pubkey: alice, contactId: aliceId, state: "sell" },
    ]);
    expect(snapshot.nearbyIdentities).toEqual([bob]);
    expect(snapshot.pendingOpen?.pubkey).toBe(alice);
  });

  it("resolves a permission request with the plugin's answer", async () => {
    const request = requestBeaconPermissions();
    plugin.emit("permission", { state: "denied" });

    expect(await request).toBe("denied");
    expect(getBeaconSnapshot().permission).toBe("denied");
  });

  it("re-reads the permission when the request fails instead of waiting", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    plugin.state.requestFails = true;
    plugin.state.permission = "prompt";

    expect(await requestBeaconPermissions()).toBe("prompt");
  });
});
