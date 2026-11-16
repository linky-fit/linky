import { ListingsDocument, Pubkey } from "@linky-fit/linkstr";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import type { KeyValuePort } from "../../../platform/ports";
import {
  forgetLegacyPeerListings,
  loadLegacyPeerListings,
  PeerListings,
  peerListingsOfRecords,
  peerListingsToStore,
  withNewerPeerListings,
} from "./listings";

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

const offering = new ListingsDocument({
  cash: "offer",
  proxyPaymentCurrencies: ["CZK"],
});
const wanting = new ListingsDocument({ cash: "want" });

describe("withNewerPeerListings", () => {
  const current = { [alice]: { document: offering, updatedAt: 100 } };

  it("takes a newer document and keeps a newer one it holds", () => {
    expect(
      withNewerPeerListings(
        current,
        { [alice]: { document: wanting, updatedAt: 120 } },
        { takeEqual: false },
      )[alice]?.document,
    ).toBe(wanting);
    expect(
      withNewerPeerListings(
        current,
        { [alice]: { document: wanting, updatedAt: 90 } },
        { takeEqual: true },
      ),
    ).toBe(current);
  });

  it("takes an equally old document only when asked to", () => {
    const equal = { [alice]: { document: wanting, updatedAt: 100 } };
    expect(withNewerPeerListings(current, equal, { takeEqual: false })).toBe(
      current,
    );
    expect(
      withNewerPeerListings(current, equal, { takeEqual: true })[alice]
        ?.document,
    ).toBe(wanting);
  });
});

describe("stored peer listings", () => {
  it("round-trips the documents through records and stores only newer ones", () => {
    const peers = { [alice]: { document: offering, updatedAt: 100 } };
    const records = peerListingsToStore(peers, [], me);
    expect(peerListingsOfRecords(records, me)).toEqual(peers);
    expect(peerListingsOfRecords(records, alice)).toEqual({});
    expect(peerListingsToStore(peers, records, me)).toEqual([]);
    expect(
      peerListingsToStore(
        { [alice]: { document: wanting, updatedAt: 120 } },
        records,
        me,
      ),
    ).toHaveLength(1);
  });

  it("leaves out a stored document this release cannot decode", () => {
    expect(
      peerListingsOfRecords(
        [{ reader: me, author: alice, document: "{", publishedAtSec: 100 }],
        me,
      ),
    ).toEqual({});
  });
});

describe("legacy peer listings cache", () => {
  it("reads what an older release cached and forgets it", () => {
    const kv = memoryKv();
    const key = `linky.listings.peers.v1.${me}`;
    kv.setItem(
      key,
      Schema.encodeSync(
        Schema.fromJsonString(Schema.Record(Pubkey, PeerListings)),
      )({ [alice]: { document: wanting, updatedAt: 1_754_000_000 } }),
    );
    expect(loadLegacyPeerListings(kv, me)?.[alice]?.updatedAt).toBe(
      1_754_000_000,
    );
    expect(loadLegacyPeerListings(kv, alice)).toBeNull();
    forgetLegacyPeerListings(kv, me);
    expect(loadLegacyPeerListings(kv, me)).toBeNull();
  });
});
