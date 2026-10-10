import { SimplePool } from "nostr-tools/pool";
import { getPublicKey } from "nostr-tools/pure";
import type { Event, Filter } from "nostr-tools";
import { normalizeAudience } from "../audience.js";
import { isNonce } from "../nonce.js";
import { LINKAUTH_WRAP_KIND, nonceHash, unwrapAssertion } from "../wrap.js";
import {
  DEFAULT_MAX_AGE_SECONDS,
  MAX_FUTURE_SECONDS,
  verifyLinkauth,
} from "./verify.js";
import type { VerifyResult } from "./verify.js";

const DEFAULT_MAX_WAIT_MS = 5000;
const MAX_EVENTS = 100;

/**
 * The slice of nostr-tools' `SimplePool` the receiver uses. Pass your own
 * pool to share connections, or a fake in tests.
 */
export interface LinkauthQueryPool {
  querySync(
    relays: string[],
    filter: Filter,
    params?: { maxWait?: number },
  ): Promise<Event[]>;
}

export interface ReceiveOptions {
  /** The secret key whose public key your domain document publishes. */
  secretKey: Uint8Array;
  /** The relays your domain document lists. */
  relays: readonly string[];
  /** Your site's origin or any URL on it; `normalizeAudience` applies. */
  audience: string;
  /** The nonce you issued for this login attempt. */
  nonce: string;
  /** Unix seconds; the server clock by default. */
  now?: number;
  /** How old a delivery and its assertion may be; 300 by default. */
  maxAgeSeconds?: number;
  /** How long to wait for slow relays; 5000 by default. */
  maxWaitMs?: number;
  /** Relay pool to query; a private `SimplePool`, destroyed afterwards, by default. */
  pool?: LinkauthQueryPool;
}

export type ReceiveResult =
  | VerifyResult
  /** No delivery for this nonce on the relays (yet): ask again shortly. */
  | { ok: false; reason: "not-delivered" };

/** Reasons that mean the assertion was for this attempt, so its answer is final. */
const isAnswerToThisNonce = (result: VerifyResult): boolean =>
  result.ok || result.reason === "expired" || result.reason === "from-future";

const query = async (options: ReceiveOptions, filter: Filter) => {
  const params = { maxWait: options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS };
  const relays = [...options.relays];
  if (options.pool !== undefined) {
    return options.pool.querySync(relays, filter, params);
  }
  const own = new SimplePool();
  try {
    return await own.querySync(relays, filter, params);
  } finally {
    own.destroy();
  }
};

/**
 * One-shot check for a cross-device login: asks the relays for recent
 * deliveries to your key tagged with the hash of your nonce, decrypts them,
 * and verifies the first assertion that carries your nonce with
 * `verifyLinkauth`. The tag only narrows the query, so flooding your public
 * key cannot crowd out the delivery; deliveries that do not decrypt, belong
 * to another login or fail before the nonce check are ignored. It holds no subscription, so it fits a serverless request.
 * Returns `not-delivered` when nothing matches. An invalid `audience`,
 * `nonce` or key is a bug in your code and throws.
 *
 * Consume the nonce when the result is final; keep it while `not-delivered`.
 */
export const receiveLinkauth = async (
  options: ReceiveOptions,
): Promise<ReceiveResult> => {
  const audience = normalizeAudience(options.audience);
  if (audience === null) throw new TypeError("linkauth: invalid audience");
  if (!isNonce(options.nonce)) throw new TypeError("linkauth: invalid nonce");
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const maxAgeSeconds = options.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS;
  const filter: Filter = {
    kinds: [LINKAUTH_WRAP_KIND],
    "#p": [getPublicKey(options.secretKey)],
    "#x": [nonceHash(options.nonce)],
    since: now - maxAgeSeconds,
    until: now + MAX_FUTURE_SECONDS,
    limit: MAX_EVENTS,
  };
  const events = await query(options, filter);
  let answer: VerifyResult | null = null;
  for (const event of events) {
    const assertion = unwrapAssertion(event, options.secretKey);
    if (assertion === null) continue;
    const result = verifyLinkauth(assertion, {
      audience,
      nonce: options.nonce,
      now,
      maxAgeSeconds,
    });
    if (result.ok) return result;
    if (answer === null && isAnswerToThisNonce(result)) answer = result;
  }
  return answer ?? { ok: false, reason: "not-delivered" };
};
