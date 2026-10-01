import { ed25519 } from "@noble/curves/ed25519";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { Schema } from "effect";
import { canonicalJsonBytes } from "./canonicalJson";

export const sha256Hex = (bytes: Uint8Array): string =>
  bytesToHex(sha256(bytes));

export const isSha256Hex = (value: string): boolean =>
  /^[0-9a-f]{64}$/.test(value);

const Ed25519Key = Schema.Struct({
  keytype: Schema.Literal("ed25519"),
  scheme: Schema.Literal("ed25519"),
  keyval: Schema.Struct({
    public: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
  }),
});
const decodeEd25519Key = Schema.decodeUnknownOption(Ed25519Key);

/** The TUF keyid: SHA-256 of the canonical `{keytype, scheme, keyval}`. */
export const keyIdOf = (publicKeyHex: string): string =>
  sha256Hex(
    canonicalJsonBytes({
      keytype: "ed25519",
      scheme: "ed25519",
      keyval: { public: publicKeyHex },
    }) ?? new Uint8Array(),
  );

/**
 * Ed25519 public keys by keyid. A key that is not Ed25519 or whose keyid is
 * not its own hash is left out, so one key can never count twice toward a
 * threshold under two keyids.
 */
export const publicKeysById = (
  keys: Readonly<Record<string, unknown>>,
): ReadonlyMap<string, Uint8Array> =>
  new Map(
    Object.entries(keys).flatMap(([keyId, raw]) => {
      const key = decodeEd25519Key(raw);
      return key._tag === "Some" && keyIdOf(key.value.keyval.public) === keyId
        ? [[keyId, hexToBytes(key.value.keyval.public)] as const]
        : [];
    }),
  );

export const verifyEd25519 = (
  publicKey: Uint8Array,
  signature: Uint8Array,
  message: Uint8Array,
): boolean => {
  try {
    return ed25519.verify(signature, message, publicKey);
  } catch {
    return false;
  }
};

export const hexToBytesOrNull = (hex: string): Uint8Array | null =>
  /^(?:[0-9a-f]{2})+$/i.test(hex) ? hexToBytes(hex.toLowerCase()) : null;

/** Strict base64url without padding; null for anything else. */
export const base64UrlToBytesOrNull = (text: string): Uint8Array | null => {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null;
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};
