import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
  vi.stubEnv("VITE_NOSTR_RELAYS", "");
  vi.stubEnv("VITE_ALLOW_INSECURE_LOCALHOST_RELAYS", "0");
});
afterEach(() => vi.unstubAllEnvs());

const recommended = {
  nostr: ["wss://nos.lol", "wss://nostr.linky.fit"],
  evolu: [],
  retiredNostr: ["wss://relay.retired.example"],
};

describe("recommended Nostr relays", () => {
  it("puts the recommended relays first, keeps the user's, drops retired ones", async () => {
    const relays = await import("./nostrRelays");
    expect(
      relays.withRecommendedNostrRelays(
        [
          "wss://custom.example",
          "wss://nos.lol/",
          "wss://relay.retired.example/",
          "broken",
        ],
        recommended,
      ),
    ).toEqual([
      "wss://nos.lol",
      "wss://nostr.linky.fit",
      "wss://custom.example",
    ]);
    expect(relays.isRecommendedNostrRelay("wss://nos.lol/", recommended)).toBe(
      true,
    );
    expect(
      relays.isRecommendedNostrRelay("wss://custom.example", recommended),
    ).toBe(false);
  });

  it("keeps environment overrides isolated from production", async () => {
    vi.stubEnv("VITE_NOSTR_RELAYS", "ws://localhost:7777");
    vi.stubEnv("VITE_ALLOW_INSECURE_LOCALHOST_RELAYS", "1");
    const relays = await import("./nostrRelays");
    expect(
      relays.withRecommendedNostrRelays(
        ["wss://relay.retired.example"],
        recommended,
      ),
    ).toEqual(["ws://localhost:7777", "wss://relay.retired.example"]);
  });

  it("falls back to the recommendation bundled with the build", async () => {
    const relays = await import("./nostrRelays");
    expect(relays.recommendedNostrRelays()).toEqual([
      "wss://nos.lol",
      "wss://nostr.linky.fit",
      "wss://nostr.eu.freedomrelay.dev",
    ]);
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
