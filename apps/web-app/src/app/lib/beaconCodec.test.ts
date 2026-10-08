import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { describe, expect, it } from "vitest";
import {
  BEACON_STATES,
  beaconEntry,
  beaconSlot,
  beaconTagMap,
  decodeBeaconPacket,
  encodeBeaconPacket,
  matchBeaconEntry,
} from "./beaconCodec";
import beaconVectors from "./beaconVectors.json";

const keyA = hexToBytes("11".repeat(32));
const keyB = hexToBytes("22".repeat(32));

describe("beaconEntry", () => {
  it.each(beaconVectors.vectors)(
    "matches the shared vector for slot $slot, nonce $nonce, state $state",
    ({ beaconKeyHex, slot, nonce, state, entryHex }) => {
      expect(
        bytesToHex(
          beaconEntry(
            hexToBytes(beaconKeyHex),
            slot,
            nonce,
            BEACON_STATES[state],
          ),
        ),
      ).toBe(entryHex);
    },
  );

  it("changes the tag with the slot and the nonce", () => {
    const entry = bytesToHex(beaconEntry(keyA, 100, 0, "nearby"));
    expect(bytesToHex(beaconEntry(keyA, 101, 0, "nearby"))).not.toBe(entry);
    expect(bytesToHex(beaconEntry(keyA, 100, 1, "nearby"))).not.toBe(entry);
  });
});

describe("beaconSlot", () => {
  it("counts ten-minute slots", () => {
    expect(beaconSlot(0)).toBe(0);
    expect(beaconSlot(599)).toBe(0);
    expect(beaconSlot(600)).toBe(1);
  });
});

describe("beacon packet", () => {
  it("round-trips entries through encode and decode", () => {
    const entries = [
      beaconEntry(keyA, 7, 3, "buy"),
      beaconEntry(keyB, 7, 3, "nearby"),
    ];
    const bytes = encodeBeaconPacket({ nonce: 3, entries });

    expect(bytes.length).toBe(2 + 3 * entries.length);
    expect(decodeBeaconPacket(bytes)).toEqual({ nonce: 3, entries });
  });

  it("rejects another version and truncated entries", () => {
    expect(decodeBeaconPacket(Uint8Array.of(2, 0))).toBeNull();
    expect(decodeBeaconPacket(Uint8Array.of(1, 0, 1, 2))).toBeNull();
    expect(decodeBeaconPacket(Uint8Array.of(1))).toBeNull();
  });
});

describe("beaconTagMap", () => {
  const map = beaconTagMap(
    [
      { id: "a", beaconKey: keyA },
      { id: "b", beaconKey: keyB },
    ],
    42,
    9,
  );

  it.each(BEACON_STATES)(
    "unmasks the %s state of a matching entry",
    (state) => {
      expect(matchBeaconEntry(map, beaconEntry(keyB, 42, 9, state))).toEqual([
        { id: "b", state },
      ]);
    },
  );

  it("matches nobody for another slot or nonce", () => {
    expect(matchBeaconEntry(map, beaconEntry(keyA, 43, 9, "sell"))).toEqual([]);
    expect(matchBeaconEntry(map, beaconEntry(keyA, 42, 8, "sell"))).toEqual([]);
  });

  it("ignores an entry whose unmasked state is unknown", () => {
    const entry = beaconEntry(keyA, 42, 9, "nearby");
    entry[2] ^= 3;
    expect(matchBeaconEntry(map, entry)).toEqual([]);
  });
});
