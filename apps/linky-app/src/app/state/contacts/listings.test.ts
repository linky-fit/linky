import { ListingsDocument, Pubkey } from "@linky-fit/linkstr";
import { describe, expect, it } from "vitest";
import type { KeyValuePort } from "../../../platform/ports";
import { loadPeerListings, savePeerListings } from "./listings";

const memoryKv = (): KeyValuePort => {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
  };
};

const me = Pubkey.make(
  "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d",
);
const alice = Pubkey.make(
  "32e1827635450ebb3c5a7d12c1f8e7b2b514439ac10a67eef3d9fd9c5c68e245",
);

describe("peer listings cache", () => {
  it("round-trips a watched document per identity", () => {
    const kv = memoryKv();
    const peers = {
      [alice]: {
        document: new ListingsDocument({ cash: "offer", listings: [] }),
        updatedAt: 1_754_000_000,
      },
    };
    savePeerListings(kv, me, peers);
    expect(loadPeerListings(kv, me)).toEqual(peers);
    expect(loadPeerListings(kv, alice)).toEqual({});
  });

  it("takes what the watch handler builds, a plain object", () => {
    const kv = memoryKv();
    savePeerListings(kv, me, {
      [alice]: {
        document: new ListingsDocument({ cash: null, listings: [] }),
        updatedAt: 1_754_000_000,
      },
    });
    expect(loadPeerListings(kv, me)[alice]?.updatedAt).toBe(1_754_000_000);
  });
});
