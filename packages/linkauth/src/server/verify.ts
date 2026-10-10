import { normalizeAudience } from "../audience.js";
import { timingSafeEqual } from "../encoding.js";
import { hasValidSignature } from "../signature.js";
import { isNonce } from "../nonce.js";
import { LINKAUTH_KIND, readAuthTemplate } from "../template.js";
import { isLinkauthAssertion } from "../types.js";

/** Seconds a login may be dated ahead of the server clock. */
export const MAX_FUTURE_SECONDS = 60;
export const DEFAULT_MAX_AGE_SECONDS = 300;

export interface VerifyExpectation {
  /** Your site's origin or any URL on it; `normalizeAudience` applies. */
  audience: string;
  /** The nonce you issued for this login attempt. */
  nonce: string;
  /** Unix seconds; the server clock by default. */
  now?: number;
  /** How old `created_at` may be; 300 by default. */
  maxAgeSeconds?: number;
}

/** Why a login was rejected. Stable: safe to log and to switch on. */
export type LinkauthFailureReason =
  /** Not JSON, or not a Nostr event. */
  | "malformed"
  | "bad-signature"
  /** Another kind, for example a NIP-98 or NIP-42 event. */
  | "wrong-kind"
  /** Extra, missing or reordered tags, or different content. */
  | "wrong-template"
  | "wrong-audience"
  | "wrong-nonce"
  | "expired"
  | "from-future";

export type VerifyResult =
  | {
      ok: true;
      /** The user's key, hex. */
      pubkey: string;
      /** When the signer signed, Unix seconds. */
      createdAt: number;
    }
  | { ok: false; reason: LinkauthFailureReason };

const fail = (reason: LinkauthFailureReason): VerifyResult => ({
  ok: false,
  reason,
});

const parse = (input: unknown): unknown => {
  if (typeof input !== "string") return input;
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
};

/**
 * Checks a login assertion (the signed event or its JSON text) against what
 * you issued: signature, kind, the exact template, your audience, your nonce
 * and its age. Expected failures return `{ ok: false, reason }`; an invalid
 * `audience` or `nonce` in `expected` is a bug in your code and throws.
 *
 * It does not remember nonces: store each nonce when you issue it and
 * consume it exactly once, whatever the result.
 */
export const verifyLinkauth = (
  assertion: unknown,
  expected: VerifyExpectation,
): VerifyResult => {
  const audience = normalizeAudience(expected.audience);
  if (audience === null) throw new TypeError("linkauth: invalid audience");
  if (!isNonce(expected.nonce)) throw new TypeError("linkauth: invalid nonce");

  const event = parse(assertion);
  if (!isLinkauthAssertion(event)) return fail("malformed");
  if (!hasValidSignature(event)) return fail("bad-signature");
  if (event.kind !== LINKAUTH_KIND) return fail("wrong-kind");
  const signed = readAuthTemplate(event);
  if (signed === null) return fail("wrong-template");
  if (signed.audience !== audience) return fail("wrong-audience");
  if (!timingSafeEqual(signed.nonce, expected.nonce))
    return fail("wrong-nonce");

  const now = expected.now ?? Math.floor(Date.now() / 1000);
  const maxAge = expected.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS;
  if (event.created_at < now - maxAge) return fail("expired");
  if (event.created_at > now + MAX_FUTURE_SECONDS) return fail("from-future");
  return { ok: true, pubkey: event.pubkey, createdAt: event.created_at };
};
