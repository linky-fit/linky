import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";

export const BEACON_SLOT_SECONDS = 600;
export const BEACON_PACKET_VERSION = 1;
const ENTRY_BYTES = 3;

/** Index into the wire state byte: 0 = nearby only, 1 = buys BTC, 2 = sells BTC. */
export const BEACON_STATES = ["nearby", "buy", "sell"] as const;
export type BeaconState = (typeof BEACON_STATES)[number];

export const beaconSlot = (nowSec: number): number =>
  Math.floor(nowSec / BEACON_SLOT_SECONDS);

const beaconMac = (
  beaconKey: Uint8Array,
  slot: number,
  nonce: number,
): Uint8Array => {
  const message = new Uint8Array(5);
  new DataView(message.buffer).setUint32(0, slot);
  message[4] = nonce;
  return hmac(sha256, beaconKey, message);
};

export const beaconEntry = (
  beaconKey: Uint8Array,
  slot: number,
  nonce: number,
  state: BeaconState,
): Uint8Array => {
  const h = beaconMac(beaconKey, slot, nonce);
  return Uint8Array.of(h[0], h[1], BEACON_STATES.indexOf(state) ^ h[2]);
};

export interface BeaconPacket {
  readonly nonce: number;
  readonly entries: ReadonlyArray<Uint8Array>;
}

export const encodeBeaconPacket = ({ nonce, entries }: BeaconPacket) =>
  Uint8Array.of(
    BEACON_PACKET_VERSION,
    nonce,
    ...entries.flatMap((entry) => [...entry]),
  );

export const decodeBeaconPacket = (bytes: Uint8Array): BeaconPacket | null => {
  if (
    bytes.length < 2 ||
    bytes[0] !== BEACON_PACKET_VERSION ||
    (bytes.length - 2) % ENTRY_BYTES !== 0
  )
    return null;
  const entries: Uint8Array[] = [];
  for (let at = 2; at < bytes.length; at += ENTRY_BYTES)
    entries.push(bytes.slice(at, at + ENTRY_BYTES));
  return { nonce: bytes[1], entries };
};

interface TagCandidate<Id> {
  readonly id: Id;
  readonly mask: number;
}

/** Listener side: the two tag bytes of every contact's entry for one slot and nonce. */
export type BeaconTagMap<Id> = ReadonlyMap<
  number,
  ReadonlyArray<TagCandidate<Id>>
>;

export const beaconTagMap = <Id>(
  contacts: ReadonlyArray<{ readonly id: Id; readonly beaconKey: Uint8Array }>,
  slot: number,
  nonce: number,
): BeaconTagMap<Id> => {
  const map = new Map<number, TagCandidate<Id>[]>();
  for (const { id, beaconKey } of contacts) {
    const h = beaconMac(beaconKey, slot, nonce);
    const tag = (h[0] << 8) | h[1];
    map.set(tag, [...(map.get(tag) ?? []), { id, mask: h[2] }]);
  }
  return map;
};

/** Every contact the entry can belong to; a 16-bit tag may collide, and a wrong mask usually yields an unknown state. */
export const matchBeaconEntry = <Id>(
  map: BeaconTagMap<Id>,
  entry: Uint8Array,
): ReadonlyArray<{ readonly id: Id; readonly state: BeaconState }> =>
  (map.get((entry[0] << 8) | entry[1]) ?? []).flatMap(({ id, mask }) => {
    const index = entry[2] ^ mask;
    return index < BEACON_STATES.length
      ? [{ id, state: BEACON_STATES[index] }]
      : [];
  });
