import { Atom } from "effect/reactivity";
import { ListingsDocument, Pubkey } from "@linky-fit/linkstr";
import { Schema } from "effect";
import type { KeyValuePort } from "../../../platform/ports";

/** An author's newest listings document and when they published it; a plain shape, so the watch handler's objects store as they are. */
export const PeerListings = Schema.Struct({
  document: ListingsDocument,
  updatedAt: Schema.Int,
});
export type PeerListings = typeof PeerListings.Type;

export type PeerListingsByPubkey = Readonly<Record<Pubkey, PeerListings>>;

/** The documents of the contacts who share with this identity, as last watched; the listings controller keeps it current. */
export const peerListingsAtom = Atom.keepAlive(
  Atom.make<PeerListingsByPubkey>({}),
);

const STORAGE_PREFIX = "linky.listings.peers.v1.";

const StoredPeerListings = Schema.fromJsonString(
  Schema.Record(Pubkey, PeerListings),
);
const decodeStored = Schema.decodeUnknownOption(StoredPeerListings);
const encodeStored = Schema.encodeSync(StoredPeerListings);

/** The cache is per identity: another identity on the device has other slots. */
export const loadPeerListings = (
  kv: KeyValuePort,
  ownPubkey: Pubkey,
): PeerListingsByPubkey => {
  const stored = kv.getItem(STORAGE_PREFIX + ownPubkey);
  if (stored === null) return {};
  const decoded = decodeStored(stored);
  return decoded._tag === "Some" ? decoded.value : {};
};

export const savePeerListings = (
  kv: KeyValuePort,
  ownPubkey: Pubkey,
  peers: PeerListingsByPubkey,
): void => {
  kv.setItem(STORAGE_PREFIX + ownPubkey, encodeStored(peers));
};
