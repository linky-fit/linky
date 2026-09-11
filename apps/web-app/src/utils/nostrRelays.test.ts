import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
  vi.stubEnv("VITE_NOSTR_RELAYS", "");
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
