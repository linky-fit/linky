import { derivePubkey, NostrSecretKey } from "@linky-fit/linkstr";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BEACON_KEYS_STORAGE_KEY,
  beaconKeysFor,
  deriveBeaconKeyHex,
} from "./beaconKeys";

const aliceSecret = NostrSecretKey.make(new Uint8Array(32).fill(1));
const bobSecret = NostrSecretKey.make(new Uint8Array(32).fill(2));
const carolSecret = NostrSecretKey.make(new Uint8Array(32).fill(3));
const alice = derivePubkey(aliceSecret);
const bob = derivePubkey(bobSecret);
const carol = derivePubkey(carolSecret);

const ALICE_BOB_KEY =
  "23d5a14bd6b62a595cf4223886a00dec8d619588cd9198d9770b360d597112f3";

const storedCache = (): unknown =>
  JSON.parse(localStorage.getItem(BEACON_KEYS_STORAGE_KEY) ?? "null");

describe("deriveBeaconKeyHex", () => {
  it("derives the same pinned key on both sides of a pair", () => {
    expect(deriveBeaconKeyHex(aliceSecret, bob)).toBe(ALICE_BOB_KEY);
    expect(deriveBeaconKeyHex(bobSecret, alice)).toBe(ALICE_BOB_KEY);
  });

  it("derives a different key for another pair", () => {
    expect(deriveBeaconKeyHex(aliceSecret, carol)).not.toBe(ALICE_BOB_KEY);
  });
});

describe("beaconKeysFor", () => {
  beforeEach(() => localStorage.clear());

  it("caches keys under the owner and keeps only the current peers", () => {
    beaconKeysFor(aliceSecret, [bob, carol]);
    const keys = beaconKeysFor(aliceSecret, [bob]);

    expect([...keys]).toEqual([[bob, ALICE_BOB_KEY]]);
    expect(storedCache()).toEqual({
      owner: alice,
      keys: { [bob]: ALICE_BOB_KEY },
    });
  });

  it("reuses a cached key instead of deriving it again", () => {
    beaconKeysFor(aliceSecret, [bob]);
    const setItem = vi.spyOn(Storage.prototype, "setItem");

    expect(beaconKeysFor(aliceSecret, [bob]).get(bob)).toBe(ALICE_BOB_KEY);
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });

  it("discards another owner's cache", () => {
    localStorage.setItem(
      BEACON_KEYS_STORAGE_KEY,
      JSON.stringify({ owner: carol, keys: { [bob]: "0".repeat(64) } }),
    );

    expect(beaconKeysFor(aliceSecret, [bob]).get(bob)).toBe(ALICE_BOB_KEY);
    expect(storedCache()).toEqual({
      owner: alice,
      keys: { [bob]: ALICE_BOB_KEY },
    });
  });
});
