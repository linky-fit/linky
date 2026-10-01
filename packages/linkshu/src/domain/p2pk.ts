import { getPubKeyFromPrivKey, pointFromHex } from "@cashu/cashu-ts";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { bech32 } from "@scure/base";
import { Option, Schema } from "effect";

const isCurvePoint = (hex: string): boolean => {
  try {
    pointFromHex(hex);
    return true;
  } catch {
    return false;
  }
};

/**
 * Compressed secp256k1 pubkey (02/03 + 64 hex) that NUT-11 proofs are locked
 * to. Validated on the curve: the mint signs outputs locked to any string, so
 * a lock to a non-point would burn the funds.
 */
export const P2pkPubkey = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(/^0[23][0-9a-f]{64}$/),
    Schema.makeFilter(isCurvePoint, { description: "a point on secp256k1" }),
  ),
  Schema.brand("P2pkPubkey"),
);
export type P2pkPubkey = typeof P2pkPubkey.Type;

/** Hex secp256k1 secret that signs for P2PK-locked proofs; never persisted. */
export const P2pkUnlockingKey = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
  Schema.brand("P2pkUnlockingKey"),
);
export type P2pkUnlockingKey = typeof P2pkUnlockingKey.Type;

const decodeP2pkPubkey = Schema.decodeUnknownOption(P2pkPubkey);

const npubToHex = (npub: string): string | null => {
  const decoded = bech32.decodeUnsafe(npub, 90);
  if (!decoded || decoded.prefix !== "npub") return null;
  const bytes = bech32.fromWordsUnsafe(decoded.words);
  return bytes instanceof Uint8Array && bytes.length === 32
    ? bytesToHex(bytes)
    : null;
};

/**
 * A lock target from user or wire input: compressed hex, x-only hex or an
 * `npub` (with or without `nostr:`). X-only keys take the even-y point
 * (`02…`), as BIP-340 does, so a Nostr key's holder can sign for it.
 */
export const parseP2pkPubkey = (raw: string): P2pkPubkey | null => {
  const value = raw
    .trim()
    .toLowerCase()
    .replace(/^nostr:/, "");
  const hex = value.startsWith("npub1") ? npubToHex(value) : value;
  if (hex === null) return null;
  const compressed = /^[0-9a-f]{64}$/.test(hex) ? `02${hex}` : hex;
  return Option.getOrNull(decodeP2pkPubkey(compressed));
};

/** The pubkey proofs locked to `key` name. */
export const p2pkPubkeyOf = (key: P2pkUnlockingKey): P2pkPubkey =>
  P2pkPubkey.make(bytesToHex(getPubKeyFromPrivKey(hexToBytes(key))));
