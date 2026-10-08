import { derivePubkey, NostrSecretKey } from "@linky-fit/linkstr";
import { createIdFromString } from "@linky-fit/linksync";
import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ stoppedByUser: false }));

const bridgeCalls = vi.hoisted(() => {
  const calls: string[][] = [];
  const record =
    (name: string) =>
    (...args: string[]) => {
      calls.push([name, ...args]);
    };
  Reflect.set(globalThis, "LinkyNativeBeacon", {
    getPermissionState: () => "granted",
    requestPermissions: record("requestPermissions"),
    setIdentity: record("setIdentity"),
    setKeys: record("setKeys"),
    setTrade: record("setTrade"),
    start: record("start"),
    stop: record("stop"),
    takeStoppedByUser: () => {
      const stopped = native.stoppedByUser;
      native.stoppedByUser = false;
      return stopped;
    },
  });
  return calls;
});

vi.mock("../../platform/runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../platform/runtime")>()),
  getPlatformTarget: () => "android",
}));

const {
  getBeaconSnapshot,
  nearbyContactsFrom,
  nearbyIdentitiesFrom,
  setBeaconEnabled,
  setBeaconKeyTable,
  setBeaconPeers,
  setBeaconTrade,
} = await import("./beaconStore");

const pubkeyOf = (fill: number) =>
  derivePubkey(NostrSecretKey.make(new Uint8Array(32).fill(fill)));
const [alice, bob, carol, mallory] = [1, 2, 3, 4].map(pubkeyOf);
const aliceId = createIdFromString<"Contact">("alice");
const bobId = createIdFromString<"Contact">("bob");
const malloryId = createIdFromString<"Contact">("mallory");

const peers = {
  contactIdByPubkey: new Map([
    [alice, aliceId],
    [bob, bobId],
    [mallory, malloryId],
  ]),
  hidden: new Set([mallory]),
};

describe("nearbyContactsFrom", () => {
  it("lists contacts with a trade first, then the most recently seen", () => {
    expect(
      nearbyContactsFrom(
        [
          { pubkey: alice, state: "nearby", lastSeenMs: 300 },
          { pubkey: bob, state: "nearby", lastSeenMs: 100 },
          { pubkey: bob, state: "sell", lastSeenMs: 200 },
          { pubkey: carol, state: "buy", lastSeenMs: 400 },
          { pubkey: mallory, state: "buy", lastSeenMs: 400 },
        ],
        peers,
      ),
    ).toEqual([
      { pubkey: bob, contactId: bobId, state: "sell" },
      { pubkey: alice, contactId: aliceId, state: "nearby" },
    ]);
  });
});

describe("nearbyIdentitiesFrom", () => {
  it("keeps only pubkeys that are neither contacts nor hidden", () => {
    expect(nearbyIdentitiesFrom([alice, carol, mallory], peers)).toEqual([
      carol,
    ]);
  });
});

describe("beacon store and native service", () => {
  const key = {
    pubkey: alice,
    beaconKeyHex: "11".repeat(32),
    priority: 0,
    name: "Alice",
  };

  beforeEach(() => {
    setBeaconEnabled(false);
    setBeaconKeyTable(null);
    setBeaconPeers({ supported: true, peers, ownPubkey: carol });
    bridgeCalls.length = 0;
  });

  it("starts only once the key table exists, pushing keys and trade first", () => {
    setBeaconEnabled(true);
    expect(bridgeCalls).toEqual([]);

    setBeaconKeyTable([key]);
    expect(bridgeCalls).toEqual([
      ["setIdentity", carol],
      ["setKeys", JSON.stringify([key])],
      ["setTrade", "none"],
      ["start"],
    ]);
    expect(getBeaconSnapshot().keyCount).toBe(1);

    setBeaconKeyTable([key]);
    setBeaconTrade("buy");
    expect(bridgeCalls.slice(4)).toEqual([["setTrade", "buy"]]);
    setBeaconTrade("none");
  });

  it("stops when the switch goes off or support is lost", () => {
    setBeaconKeyTable([key]);
    setBeaconEnabled(true);
    setBeaconEnabled(false);
    expect(bridgeCalls.at(-1)).toEqual(["stop"]);

    setBeaconEnabled(true);
    setBeaconPeers({ supported: false, peers, ownPubkey: carol });
    expect(bridgeCalls.at(-1)).toEqual(["stop"]);
  });

  const dispatchStatus = (running: boolean, error: string | null) =>
    window.dispatchEvent(
      new CustomEvent("linky-beacon-status", {
        detail: JSON.stringify({
          running,
          bluetoothOn: true,
          advertising: running,
          error,
        }),
      }),
    );

  it("keeps the switch on when native could not start", () => {
    setBeaconKeyTable([key]);
    setBeaconEnabled(true);
    dispatchStatus(false, "permission");

    expect(getBeaconSnapshot().enabled).toBe(true);
    expect(getBeaconSnapshot().status.error).toBe("permission");

    bridgeCalls.length = 0;
    setBeaconTrade("sell");
    expect(bridgeCalls.at(-1)).toEqual(["start"]);
    setBeaconTrade("none");
  });

  it("turns the switch off when the notification stopped the service", () => {
    setBeaconKeyTable([key]);
    setBeaconEnabled(true);
    dispatchStatus(true, null);
    native.stoppedByUser = true;
    dispatchStatus(false, null);

    expect(getBeaconSnapshot().enabled).toBe(false);
    expect(localStorage.getItem("linky.beacon.enabled.v1")).toBeNull();
    expect(native.stoppedByUser).toBe(false);
  });

  it("retries a refused start when the app returns to the foreground", () => {
    setBeaconKeyTable([key]);
    setBeaconEnabled(true);
    dispatchStatus(false, "start_not_allowed");
    bridgeCalls.length = 0;

    document.dispatchEvent(new Event("visibilitychange"));
    expect(bridgeCalls.at(-1)).toEqual(["start"]);
    expect(getBeaconSnapshot().enabled).toBe(true);
  });

  it("mirrors native nearby and identity snapshots", () => {
    window.dispatchEvent(
      new CustomEvent("linky-beacon-nearby", {
        detail: JSON.stringify({
          contacts: [{ pubkey: alice, state: "buy", lastSeenMs: 1 }],
        }),
      }),
    );
    window.dispatchEvent(
      new CustomEvent("linky-beacon-identities", {
        detail: JSON.stringify({ pubkeys: [bob, carol, "not-a-pubkey"] }),
      }),
    );

    expect(getBeaconSnapshot().nearbyContacts).toEqual([
      { pubkey: alice, contactId: aliceId, state: "buy" },
      { pubkey: bob, contactId: bobId, state: "nearby" },
    ]);
    expect(getBeaconSnapshot().nearbyIdentities).toEqual([carol]);
  });

  it("ignores a malformed event", () => {
    const before = getBeaconSnapshot();
    window.dispatchEvent(
      new CustomEvent("linky-beacon-permission", { detail: "{" }),
    );
    expect(getBeaconSnapshot()).toBe(before);
  });
});

describe("beacon store at launch", () => {
  const launch = async () => {
    vi.resetModules();
    return (await import("./beaconStore")).getBeaconSnapshot();
  };

  it("starts with the switch off after the notification stopped the service unheard", async () => {
    localStorage.setItem("linky.beacon.enabled.v1", "true");
    native.stoppedByUser = true;

    expect((await launch()).enabled).toBe(false);
    expect(localStorage.getItem("linky.beacon.enabled.v1")).toBeNull();
  });

  it("keeps the switch on when no Stop is pending", async () => {
    localStorage.setItem("linky.beacon.enabled.v1", "true");

    expect((await launch()).enabled).toBe(true);
  });
});
