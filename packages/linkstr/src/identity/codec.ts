import { Option, Schema } from "effect";
import { getPublicKey, nip19 } from "nostr-tools";
import { getConversationKey } from "nostr-tools/nip44";
import { NostrSecretKey, Pubkey } from "../domain/primitives";

const decodeSecretKey = Schema.decodeUnknownOption(NostrSecretKey);
const decodePubkey = Schema.decodeUnknownOption(Pubkey);

export const decodeNsec = (value: string): NostrSecretKey | null => {
  try {
    const decoded = nip19.decode(value);
    if (decoded.type !== "nsec") return null;
    return Option.getOrNull(decodeSecretKey(decoded.data));
  } catch {
    return null;
  }
};

export const encodeNsec = (secretKey: NostrSecretKey): string =>
  nip19.nsecEncode(secretKey);

export const decodeNpub = (value: string): Pubkey | null => {
  try {
    const decoded = nip19.decode(value);
    if (decoded.type !== "npub") return null;
    return Option.getOrNull(decodePubkey(decoded.data));
  } catch {
    return null;
  }
};

export const encodeNpub = (pubkey: Pubkey): string => nip19.npubEncode(pubkey);

export const derivePubkey = (secretKey: NostrSecretKey): Pubkey =>
  Pubkey.make(getPublicKey(secretKey));

/** The NIP-44 conversation key both sides of a pair derive alike; key material, never log it. */
export const deriveConversationKey = (
  secretKey: NostrSecretKey,
  pubkey: Pubkey,
): Uint8Array => getConversationKey(secretKey, pubkey);

export const parsePubkey = (value: string): Pubkey | null => {
  const decoded = decodeNpub(value);
  if (decoded) return decoded;
  return Option.getOrNull(decodePubkey(value.toLowerCase()));
};

export const identityFromNsec = (
  value: string,
): { secretKey: NostrSecretKey; pubkey: Pubkey } | null => {
  const secretKey = decodeNsec(value);
  if (!secretKey) return null;
  return { secretKey, pubkey: derivePubkey(secretKey) };
};

export const decodeNprofilePubkey = (value: string): Pubkey | null => {
  try {
    const decoded = nip19.decode(value);
    if (decoded.type !== "nprofile") return null;
    return Option.getOrNull(decodePubkey(decoded.data.pubkey));
  } catch {
    return null;
  }
};

export const encodeNprofile = (
  pubkey: Pubkey,
  relays: readonly string[],
): string => nip19.nprofileEncode({ pubkey, relays: [...relays] });
