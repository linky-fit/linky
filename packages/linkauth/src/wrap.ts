import { sha256 } from "@noble/hashes/sha2.js";
import { finalizeEvent, generateSecretKey } from "nostr-tools/pure";
import type { Event } from "nostr-tools";
import { decrypt, encrypt, getConversationKey } from "nostr-tools/nip44";
import { bytesToHex } from "nostr-tools/utils";
import { hasValidSignature } from "./signature.js";
import { readAuthTemplate } from "./template.js";
import { isLinkauthAssertion } from "./types.js";
import type { LinkauthAssertion } from "./types.js";

/** Regular Nostr kind (NIP-59 gift wrap) that carries an assertion to a site. */
export const LINKAUTH_WRAP_KIND = 1059;

/** The wrap tag that lets a site's relays select one login: `["x", <nonceHash>]`. */
const NONCE_HASH_TAG = "x";

/** Hex SHA-256 of the nonce: relays can filter on it without learning the nonce. */
export const nonceHash = (nonce: string): string =>
  bytesToHex(sha256(new TextEncoder().encode(nonce)));

/** How long relays keep a wrap (NIP-40), so a leaked site key does not expose old logins. */
const WRAP_LIFETIME_SECONDS = 600;

/** The tags of a wrap of `assertion` for `domainPubkey` created at `createdAt`; `null` unless it is a canonical login. */
export const wrapTags = (
  assertion: LinkauthAssertion,
  domainPubkey: string,
  createdAt: number,
): string[][] | null => {
  const login = readAuthTemplate(assertion);
  return login === null
    ? null
    : [
        ["p", domainPubkey],
        [NONCE_HASH_TAG, nonceHash(login.nonce)],
        ["expiration", String(createdAt + WRAP_LIFETIME_SECONDS)],
      ];
};

/**
 * The event a signer publishes to deliver `assertion` to the site that owns
 * `domainPubkey`: kind 1059 from a throwaway key, tagged `p` with the site's
 * key, `x` with the SHA-256 hex of the login's nonce and a NIP-40
 * `expiration` 10 minutes ahead, content the assertion JSON NIP-44
 * encrypted to that key. Pure: the caller publishes it. Throws `TypeError`
 * for a malformed assertion or one that is not a canonical login.
 */
export const wrapAssertion = (
  assertion: LinkauthAssertion,
  domainPubkey: string,
): Event => {
  if (!isLinkauthAssertion(assertion)) {
    throw new TypeError("linkauth: malformed assertion");
  }
  const createdAt = Math.floor(Date.now() / 1000);
  const tags = wrapTags(assertion, domainPubkey, createdAt);
  if (tags === null) throw new TypeError("linkauth: not a login assertion");
  const throwaway = generateSecretKey();
  try {
    return finalizeEvent(
      {
        kind: LINKAUTH_WRAP_KIND,
        created_at: createdAt,
        tags,
        content: encrypt(
          JSON.stringify(assertion),
          getConversationKey(throwaway, domainPubkey),
        ),
      },
      throwaway,
    );
  } finally {
    throwaway.fill(0);
  }
};

/**
 * The assertion inside a wrap addressed to `secretKey`'s owner; `null` for
 * anything else, including a wrap whose `x` tag is not the hash of its own
 * nonce. Not verified as a login.
 */
export const unwrapAssertion = (
  wrap: Event,
  secretKey: Uint8Array,
): LinkauthAssertion | null => {
  if (wrap.kind !== LINKAUTH_WRAP_KIND || !hasValidSignature(wrap)) return null;
  try {
    const value: unknown = JSON.parse(
      decrypt(wrap.content, getConversationKey(secretKey, wrap.pubkey)),
    );
    if (!isLinkauthAssertion(value)) return null;
    const login = readAuthTemplate(value);
    return login !== null &&
      wrap.tags.some(
        ([name, hash]) =>
          name === NONCE_HASH_TAG && hash === nonceHash(login.nonce),
      )
      ? value
      : null;
  } catch {
    return null;
  }
};
