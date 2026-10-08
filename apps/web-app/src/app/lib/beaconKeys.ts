import {
  deriveConversationKey,
  derivePubkey,
  type NostrSecretKey,
  type Pubkey,
} from "@linky-fit/linkstr";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { Schema } from "effect";
import {
  safeLocalStorageGetJson,
  safeLocalStorageSetJson,
} from "../../utils/storage";

export const BEACON_KEYS_STORAGE_KEY = "linky.beacon.keys.v1";

const Hex64 = Schema.String.pipe(Schema.pattern(/^[0-9a-f]{64}$/));
const BeaconKeyCache = Schema.Struct({
  owner: Hex64,
  keys: Schema.Record({ key: Hex64, value: Hex64 }),
});

/** The pairwise key both sides of a contact pair derive alike, as hex. */
export const deriveBeaconKeyHex = (
  secretKey: NostrSecretKey,
  peer: Pubkey,
): string =>
  bytesToHex(
    hkdf(
      sha256,
      deriveConversationKey(secretKey, peer),
      new Uint8Array(0),
      utf8ToBytes("linky-beacon-v1"),
      32,
    ),
  );

/**
 * Beacon keys for `peers`, deriving only those the device-local cache lacks.
 * The cache keeps exactly `peers`, so removed contacts' keys do not linger.
 */
export const beaconKeysFor = (
  secretKey: NostrSecretKey,
  peers: ReadonlyArray<Pubkey>,
): ReadonlyMap<Pubkey, string> => {
  const owner = derivePubkey(secretKey);
  const cached = safeLocalStorageGetJson(
    BEACON_KEYS_STORAGE_KEY,
    Schema.NullOr(BeaconKeyCache),
    null,
  );
  const known = new Map(
    cached?.owner === owner ? Object.entries(cached.keys) : [],
  );
  const keys = new Map(
    peers.map((peer) => [
      peer,
      known.get(peer) ?? deriveBeaconKeyHex(secretKey, peer),
    ]),
  );
  const next = { owner, keys: Object.fromEntries(keys) };
  if (JSON.stringify(next) !== JSON.stringify(cached))
    safeLocalStorageSetJson(BEACON_KEYS_STORAGE_KEY, next);
  return keys;
};
