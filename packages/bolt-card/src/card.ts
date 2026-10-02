import { schnorr } from "@noble/curves/secp256k1.js";
import { bytesToHex, hexToBytes, randomBytes } from "@noble/ciphers/utils.js";
import { Option, Schema } from "effect";
import {
  encryptPiccData,
  MAX_SUN_COUNTER,
  sunMac,
  verifySun,
  type SunData,
} from "./sun";

const hexOfLength = (length: number) =>
  Schema.String.pipe(Schema.pattern(new RegExp(`^[0-9a-f]{${length}}$`)));

/** The x-only public key of the card, as 64 lowercase hex characters. */
export const BoltCardId = hexOfLength(64).pipe(Schema.brand("BoltCardId"));
export type BoltCardId = typeof BoltCardId.Type;

/** A device-local emulated card; only `counter` changes over its life. */
export interface BoltCard {
  readonly k1: Uint8Array;
  readonly k2: Uint8Array;
  readonly uid: Uint8Array;
  /** Signs the card bridge challenge; its public key is the card id. */
  readonly secretKey: Uint8Array;
  /** The last counter handed out in a tap URL; 0 before the first tap. */
  readonly counter: number;
}

export interface BoltCardTap {
  /** The card with `counter` advanced; persist it before serving `url`. */
  readonly card: BoltCard;
  readonly counter: number;
  /** Uppercase hex `p` exactly as it appears in `url`. */
  readonly p: string;
  readonly url: string;
}

const NXP_UID_PREFIX = 0x04;

const StoredBoltCard = Schema.Struct({
  version: Schema.Literal(1),
  k1: hexOfLength(32),
  k2: hexOfLength(32),
  uid: hexOfLength(14),
  secretKey: hexOfLength(64),
  counter: Schema.Int.pipe(Schema.between(0, MAX_SUN_COUNTER)),
});

const decodeStoredBoltCard = Schema.decodeUnknownOption(
  Schema.parseJson(StoredBoltCard),
);

export const createBoltCard = (): BoltCard => ({
  k1: randomBytes(16),
  k2: randomBytes(16),
  // Real cards carry a 7-byte NXP UID; matching the prefix keeps POS logs plausible.
  uid: Uint8Array.of(NXP_UID_PREFIX, ...randomBytes(6)),
  secretKey: schnorr.utils.randomSecretKey(),
  counter: 0,
});

export const boltCardId = (card: BoltCard): BoltCardId =>
  BoltCardId.make(bytesToHex(schnorr.getPublicKey(card.secretKey)));

export const serializeBoltCard = (card: BoltCard): string =>
  JSON.stringify({
    version: 1,
    k1: bytesToHex(card.k1),
    k2: bytesToHex(card.k2),
    uid: bytesToHex(card.uid),
    secretKey: bytesToHex(card.secretKey),
    counter: card.counter,
  } satisfies typeof StoredBoltCard.Type);

/** Null for anything that is not a stored card, so the caller can start over. */
export const parseBoltCard = (text: string): BoltCard | null =>
  Option.getOrNull(
    Option.map(decodeStoredBoltCard(text), (stored) => ({
      k1: hexToBytes(stored.k1),
      k2: hexToBytes(stored.k2),
      uid: hexToBytes(stored.uid),
      secretKey: hexToBytes(stored.secretKey),
      counter: stored.counter,
    })),
  );

/**
 * The LNURL-withdraw URL a POS reads from the card. `https` bridges become
 * `lnurlw://` like a physical bolt card; plain `http` (local development)
 * stays as is, because `lnurlw://` always resolves to https.
 */
export const boltCardBaseUrl = (bridgeUrl: string, cardId: BoltCardId) => {
  const url = new URL(`w/${cardId}`, bridgeUrl.replace(/\/*$/, "/"));
  return url.protocol === "https:"
    ? `lnurlw://${url.host}${url.pathname}`
    : url.toString();
};

/** Advances the counter and builds the next tap URL; null once it is exhausted. */
export const issueBoltCardTap = (
  card: BoltCard,
  bridgeUrl: string,
  random?: Uint8Array,
): BoltCardTap | null => {
  if (card.counter >= MAX_SUN_COUNTER) return null;
  const counter = card.counter + 1;
  const data = { uid: card.uid, counter };
  const p = bytesToHex(encryptPiccData(card.k1, data, random)).toUpperCase();
  const c = bytesToHex(sunMac(card.k2, data)).toUpperCase();
  return {
    card: { ...card, counter },
    counter,
    p,
    url: `${boltCardBaseUrl(bridgeUrl, boltCardId(card))}?p=${p}&c=${c}`,
  };
};

const HEX_P = /^[0-9a-fA-F]{32}$/;
const HEX_C = /^[0-9a-fA-F]{16}$/;

/** Checks a tap's hex `p` and `c` against the card; null unless they are its own. */
export const verifyBoltCardTap = (
  card: BoltCard,
  p: string,
  c: string,
): SunData | null =>
  HEX_P.test(p) && HEX_C.test(c)
    ? verifySun(
        card,
        card.uid,
        hexToBytes(p.toLowerCase()),
        hexToBytes(c.toLowerCase()),
      )
    : null;
