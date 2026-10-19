import { describe, expect, it } from "vitest";
import { memoryKvPorts } from "../testUtils/appRegistry";
import { carryLegacySettings, parseLegacyWebStorage } from "./legacyWebStorage";

const PUBKEY = "a".repeat(64);
const relayCache = JSON.stringify({
  relayUrls: ["wss://relay.example"],
  relaysUpdatedAt: 1,
  dmRelaysUpdatedAt: null,
});

const carry = (
  storage: Record<string, string>,
  native: Record<string, string> = {},
) => {
  const { items, ports } = memoryKvPorts(native);
  const counts = carryLegacySettings(storage, ports.kv);
  return { counts, kv: Object.fromEntries(items) };
};

describe("carryLegacySettings", () => {
  it("copies the device settings, relay lists and cashu state the app reads", () => {
    const storage = {
      "linky.lang": "cs",
      "linky.color_mode": "dark",
      "linky.display_currency.v1": "czk",
      "linky.display_allowed_currencies.v1": '["czk","sat"]',
      linky_use_btc_symbol: "1",
      "linky.receive_method.v1": "lightning",
      "linky.inspector_enabled": "true",
      "linky.contacts_onboarding_dismissed": "1",
      "linky.nostr_identity_source.v1": "custom",
      "linky.nostr_identity_switched_at_sec.v1": "1700000000",
      "linky.evoluServers.user.v1": '["ws://127.0.0.1:4001"]',
      "linky.evoluServers.defaultRemoved.v1": "true",
      [`linky.nostr_relays.v1.${PUBKEY}`]: relayCache,
      "linky.linkshu.value.linkshu.detCounter.mint.sat.00ab": "42",
      "linky.linkshu.value.linkshu.pendingTopup.op1": '{"quoteId":"q"}',
      "linky.local.npubCashClaimInbox.v1.owner.abc": "cashuBtoken",
      "linky.outbox": "[]",
    };
    const { counts, kv } = carry(storage);
    expect(kv).toEqual(storage);
    expect(counts).toEqual({ copied: 17, kept: 0, invalid: 0 });
  });

  it("skips secrets and keys outside the whitelist", () => {
    const { counts, kv } = carry({
      "linky.nostr_nsec": "nsec1secret",
      "linky.initialMnemonic": "words",
      "linky.local.pendingPayments.v1.owner": "[]",
      "linky.inbox_cursor.abc": "1",
      "linky.linkshu.lease.x": "{}",
    });
    expect(kv).toEqual({});
    expect(counts).toEqual({ copied: 0, kept: 0, invalid: 0 });
  });

  it.each([
    ["linky.lang", "xx"],
    ["linky.color_mode", "purple"],
    ["linky.display_currency.v1", "doge"],
    ["linky.receive_method.v1", "carrier pigeon"],
    ["linky.evoluServers.user.v1", "ws://not-json"],
    ["linky.evoluServers.user.v1", "[1, 2]"],
    [`linky.nostr_relays.v1.${PUBKEY}`, '{"relayUrls":"wss://x"}'],
    ["linky.linkshu.value.linkshu.detCounter.mint.sat.00ab", "-1"],
    ["linky.local.npubCashClaimInbox.v1.owner.abc", "nsec1"],
  ])("rejects %s = %j", (key, value) => {
    const { counts, kv } = carry({ [key]: value });
    expect(kv).toEqual({});
    expect(counts.invalid).toBe(1);
  });

  it("keeps what the native side already holds", () => {
    const { counts, kv } = carry(
      { "linky.lang": "cs" },
      { "linky.lang": "en" },
    );
    expect(kv).toEqual({ "linky.lang": "en" });
    expect(counts).toEqual({ copied: 0, kept: 1, invalid: 0 });
  });
});

describe("parseLegacyWebStorage", () => {
  it("reads a string map", () => {
    expect(parseLegacyWebStorage('{"a":"b"}')).toEqual({ a: "b" });
  });

  it.each(["[]", '{"a":1}', "not json"])("rejects %j", (dump) => {
    expect(parseLegacyWebStorage(dump)).toBeNull();
  });
});
