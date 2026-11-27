import { Atom } from "effect/reactivity";
import {
  isEmptyListingsDocument,
  ListingsDocument,
  Pubkey,
} from "@linky-fit/linkstr";
import type { PeerListingsRecord } from "@linky-fit/linksync";
import { Option, Schema } from "effect";
import type { KeyValuePort } from "../../../platform/ports";

/** An author's newest listings document and when they published it; a plain shape, so the watch handler's objects store as they are. */
export const PeerListings = Schema.Struct({
  document: ListingsDocument,
  updatedAt: Schema.Int,
  /** Whether the author gave this identity a key slot; unknown for a stored copy. */
  reachesReader: Schema.optionalKey(Schema.Boolean),
});
export type PeerListings = typeof PeerListings.Type;

/** Whether the author shares with this identity; a stored copy that says nothing counts as not shared, like one without a slot. */
export const peerListingsReachReader = ({
  document,
  reachesReader,
}: PeerListings): boolean =>
  reachesReader ??
  (!isEmptyListingsDocument(document) ||
    document.proxyPaymentCurrencies !== undefined);

export type PeerListingsByPubkey = Readonly<Record<Pubkey, PeerListings>>;

/** The documents of the contacts who share with this identity, as last watched or stored; the listings controller keeps it current. */
export const peerListingsAtom = Atom.keepAlive(
  Atom.make<PeerListingsByPubkey>({}),
);

const isPubkey = Schema.is(Pubkey);

/**
 * `current` with each of `incoming` that is newer than what it holds; with
 * `takeEqual` an equally old one replaces it too, as a document just read
 * from a relay may hold more than a stored copy of the same event.
 */
export const withNewerPeerListings = (
  current: PeerListingsByPubkey,
  incoming: PeerListingsByPubkey,
  { takeEqual }: { readonly takeEqual: boolean },
): PeerListingsByPubkey => {
  let next: Record<Pubkey, PeerListings> | null = null;
  for (const [pubkey, entry] of Object.entries(incoming)) {
    if (!isPubkey(pubkey)) continue;
    const known = current[pubkey];
    if (
      known &&
      (known.updatedAt > entry.updatedAt ||
        (!takeEqual && known.updatedAt === entry.updatedAt))
    ) {
      continue;
    }
    next ??= { ...current };
    next[pubkey] = entry;
  }
  return next ?? current;
};

const DocumentJson = Schema.fromJsonString(ListingsDocument);
const decodeDocumentJson = Schema.decodeUnknownOption(DocumentJson);
const encodeDocumentJson = Schema.encodeSync(DocumentJson);

/** The stored documents `reader` read, by author; a document this release cannot decode is left out. */
export const peerListingsOfRecords = (
  records: ReadonlyArray<PeerListingsRecord>,
  reader: Pubkey,
): PeerListingsByPubkey => {
  const byAuthor: Record<Pubkey, PeerListings> = {};
  for (const record of records) {
    if (record.reader !== reader) continue;
    const document = decodeDocumentJson(record.document);
    if (Option.isNone(document)) continue;
    byAuthor[record.author] = {
      document: document.value,
      updatedAt: record.publishedAtSec,
    };
  }
  return byAuthor;
};

/** The documents newer than their stored copy, as records to store for `reader`. */
export const peerListingsToStore = (
  peers: PeerListingsByPubkey,
  records: ReadonlyArray<PeerListingsRecord>,
  reader: Pubkey,
): ReadonlyArray<PeerListingsRecord> => {
  const storedAt = new Map(
    records
      .filter((record) => record.reader === reader)
      .map((record) => [record.author, record.publishedAtSec]),
  );
  return Object.entries(peers).flatMap(([author, { document, updatedAt }]) =>
    isPubkey(author) && updatedAt > 0 && updatedAt > (storedAt.get(author) ?? 0)
      ? [
          {
            reader,
            author,
            document: encodeDocumentJson(document),
            publishedAtSec: updatedAt,
          },
        ]
      : [],
  );
};

// Migration bridge; removal gate in app/migrations/AGENTS.md
const LEGACY_STORAGE_PREFIX = "linky.listings.peers.v1.";

const LegacyPeerListings = Schema.fromJsonString(
  Schema.Record(Pubkey, PeerListings),
);
const decodeLegacy = Schema.decodeUnknownOption(LegacyPeerListings);

/** What releases before the `peerListings` table cached on this device for one identity. */
export const loadLegacyPeerListings = (
  kv: KeyValuePort,
  ownPubkey: Pubkey,
): PeerListingsByPubkey | null => {
  const stored = kv.getItem(LEGACY_STORAGE_PREFIX + ownPubkey);
  if (stored === null) return null;
  return Option.getOrElse(decodeLegacy(stored), () => ({}));
};

export const forgetLegacyPeerListings = (
  kv: KeyValuePort,
  ownPubkey: Pubkey,
): void => {
  kv.removeItem(LEGACY_STORAGE_PREFIX + ownPubkey);
};
