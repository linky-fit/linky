import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
  vi.stubEnv("VITE_NOSTR_RELAYS", "");
  vi.stubEnv("VITE_ALLOW_INSECURE_LOCALHOST_RELAYS", "0");
});
afterEach(() => vi.unstubAllEnvs());

describe("Nostr relay migration scope", () => {
  it("tracks completion separately for each identity", async () => {
    const relays = await import("./nostrRelays");
    relays.completeLinkyNostrRelayMigration("alice");
    expect(relays.needsLinkyNostrRelayMigration("alice")).toBe(false);
    expect(relays.needsLinkyNostrRelayMigration("bob")).toBe(true);
  });

  it("keeps environment overrides isolated from production", async () => {
    vi.stubEnv("VITE_NOSTR_RELAYS", "ws://localhost:7777");
    vi.stubEnv("VITE_ALLOW_INSECURE_LOCALHOST_RELAYS", "1");
    const relays = await import("./nostrRelays");
    expect(relays.loadInitialRelayUrls("alice")).toEqual([
      "ws://localhost:7777",
    ]);
    expect(relays.needsLinkyNostrRelayMigration("alice")).toBe(false);
  });

  it("starts with Linky when an old relay cache is malformed", async () => {
    localStorage.setItem(
      "linky.nostr_relays.v1.alice",
      '{"relayUrls":["invalid"]}',
    );
    const relays = await import("./nostrRelays");
    expect(relays.loadInitialRelayUrls("alice")).toContain(
      relays.LINKY_NOSTR_RELAY,
    );
    expect(relays.needsLinkyNostrRelayMigration("alice")).toBe(true);
  });
});

it("filters insecure and malformed URLs before cache persistence and connection", async () => {
  const relays = await import("./nostrRelays");
  relays.saveCachedRelayLists("alice", {
    relayUrls: [
      "ws://localhost:7777",
      "ws://attacker.example",
      "broken",
      "wss://relay.example",
    ],
    relaysUpdatedAt: null,
    dmRelaysUpdatedAt: null,
  });
  expect(relays.loadCachedRelayLists("alice")?.relayUrls).toEqual([
    "wss://relay.example",
  ]);
  expect(relays.isRelayUrl("ws://localhost:7777")).toBe(false);
});
