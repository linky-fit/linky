import { secp256k1 } from "@noble/curves/secp256k1";
import type { NostrSecretKey } from "@linky-fit/linkstr";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { IdentityDerivationError } from "./slip39";

// LUD-05 derives LNURL-auth linking keys from a BIP-32 seed, which only
// SLIP-39 logins have. Linky derives them from the active Nostr secret key
// instead so pasted-nsec logins get the same per-domain identities, at the
// cost of interoperability with other wallets (nothing to interoperate with:
// a linking key is only ever compared against itself).
const HASHING_KEY_MESSAGE = "linky/lnurl-auth/hashing-key/v1";

// Every 256th key would be out of the secp256k1 range at ~2^-128 odds per
// candidate; re-deriving under a suffix keeps such a domain usable instead of
// permanently unauthenticatable.
const MAX_LINKING_KEY_ATTEMPTS = 256;

export interface LnurlAuthSignature {
  /** Compressed secp256k1 linking public key, hex — LUD-04 `key`. */
  readonly publicKeyHex: string;
  /** DER-encoded ECDSA signature over the challenge, hex — LUD-04 `sig`. */
  readonly signatureHex: string;
}

const utf8 = (value: string): Uint8Array => new TextEncoder().encode(value);

const deriveLinkingSecretKey = (
  nostrSecretKey: NostrSecretKey,
  domain: string,
): Uint8Array => {
  const hashingKey = hmac(sha256, nostrSecretKey, utf8(HASHING_KEY_MESSAGE));

  for (let attempt = 0; attempt < MAX_LINKING_KEY_ATTEMPTS; attempt += 1) {
    const message = attempt === 0 ? domain : `${domain}/${attempt}`;
    const candidate = hmac(sha256, hashingKey, utf8(message));
    if (secp256k1.utils.isValidPrivateKey(candidate)) return candidate;
  }

  throw new IdentityDerivationError({
    message: `LNURL-auth linking key derivation failed for ${domain}`,
  });
};

/**
 * Domains are the identity boundary of LNURL-auth: the same user must get the
 * same key back on every visit to `example.com` and an unlinkable one on every
 * other site, so the caller's casing and trailing dot must not change it.
 */
export const normalizeLnurlAuthDomain = (domain: string): string =>
  domain.trim().toLowerCase().replace(/\.$/, "");

export const deriveLnurlAuthPublicKeyHex = (
  nostrSecretKey: NostrSecretKey,
  domain: string,
): string =>
  bytesToHex(
    secp256k1.getPublicKey(
      deriveLinkingSecretKey(nostrSecretKey, normalizeLnurlAuthDomain(domain)),
      true,
    ),
  );

export const signLnurlAuthChallenge = ({
  challenge,
  domain,
  nostrSecretKey,
}: {
  challenge: Uint8Array;
  domain: string;
  nostrSecretKey: NostrSecretKey;
}): LnurlAuthSignature => {
  if (challenge.length !== 32) {
    throw new IdentityDerivationError({
      message: "LNURL-auth challenge must be 32 bytes",
    });
  }

  const linkingSecretKey = deriveLinkingSecretKey(
    nostrSecretKey,
    normalizeLnurlAuthDomain(domain),
  );

  // LUD-04 signs the k1 challenge itself, so the bytes must not be hashed
  // again before signing.
  const signature = secp256k1.sign(challenge, linkingSecretKey);

  return {
    publicKeyHex: bytesToHex(secp256k1.getPublicKey(linkingSecretKey, true)),
    signatureHex: signature.toDERHex(),
  };
};
