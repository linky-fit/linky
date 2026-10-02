import { cbc, cmac } from "@noble/ciphers/aes.js";
import { equalBytes, randomBytes } from "@noble/ciphers/utils.js";

/** The NTAG 424 DNA read counter is 3 bytes; a card past it cannot tap. */
export const MAX_SUN_COUNTER = 0xff_ff_ff;

const PICC_DATA_TAG = 0xc7;
const SV2_PREFIX = Uint8Array.of(0x3c, 0xc3, 0x00, 0x01, 0x00, 0x80);
const ZERO_IV = new Uint8Array(16);

export interface SunData {
  readonly uid: Uint8Array;
  readonly counter: number;
}

const counterBytes = (counter: number): Uint8Array => {
  if (!Number.isInteger(counter) || counter < 0 || counter > MAX_SUN_COUNTER) {
    throw new RangeError("SUN counter must fit 3 bytes");
  }
  // The card sends its counter least significant byte first.
  return Uint8Array.of(
    counter & 0xff,
    (counter >> 8) & 0xff,
    (counter >> 16) & 0xff,
  );
};

const concatBytes = (...parts: readonly Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

/** `p`: one AES-CBC block of tag, UID, counter and 5 random bytes under K1. */
export const encryptPiccData = (
  k1: Uint8Array,
  { uid, counter }: SunData,
  random: Uint8Array = randomBytes(5),
): Uint8Array =>
  cbc(k1, ZERO_IV, { disablePadding: true }).encrypt(
    concatBytes(
      Uint8Array.of(PICC_DATA_TAG),
      uid,
      counterBytes(counter),
      random,
    ),
  );

/** Null when `p` is not one block or does not carry the PICC data tag. */
export const decryptPiccData = (
  k1: Uint8Array,
  p: Uint8Array,
): SunData | null => {
  if (p.length !== 16) return null;
  const plain = cbc(k1, ZERO_IV, { disablePadding: true }).decrypt(p);
  if (plain[0] !== PICC_DATA_TAG) return null;
  return {
    uid: plain.slice(1, 8),
    counter: plain[8]! | (plain[9]! << 8) | (plain[10]! << 16),
  };
};

/** `c`: the odd bytes of the session-key CMAC over an empty message. */
export const sunMac = (
  k2: Uint8Array,
  { uid, counter }: SunData,
): Uint8Array => {
  const sessionKey = cmac(
    k2,
    concatBytes(SV2_PREFIX, uid, counterBytes(counter)),
  );
  const full = cmac(sessionKey, new Uint8Array());
  return full.filter((_, index) => index % 2 === 1);
};

/** Decrypts `p` and checks `c`; null unless both belong to this UID. */
export const verifySun = (
  keys: { readonly k1: Uint8Array; readonly k2: Uint8Array },
  uid: Uint8Array,
  p: Uint8Array,
  c: Uint8Array,
): SunData | null => {
  const data = decryptPiccData(keys.k1, p);
  if (data === null || !equalBytes(data.uid, uid)) return null;
  return equalBytes(sunMac(keys.k2, data), c) ? data : null;
};
