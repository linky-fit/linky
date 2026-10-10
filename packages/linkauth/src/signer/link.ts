import { normalizeAudience } from "../audience.js";
import { encodeAssertion, ERROR_KEY, RESULT_KEY } from "../callback.js";
import { plainCallback } from "../domain.js";
import { fetchDomainDocument } from "../fetchDomain.js";
import type { DomainFailure, FetchDomainOptions } from "../fetchDomain.js";
import { isNonce } from "../nonce.js";
import { authTemplate } from "../template.js";
import type { LinkauthAssertion, LinkauthTemplate } from "../types.js";

const LINK_PREFIX = "linkauth?";

/** What a signer link carries: nothing about the site beyond its origin. */
export interface LinkauthLink {
  /** The origin the login is bound to; its domain document supplies everything else. */
  audience: string;
  nonce: string;
  /** Normalized return page, or `null` for cross-device delivery over Nostr. */
  callback: string | null;
}

/** A login whose site was verified through its domain document. */
export interface LinkauthLogin {
  /** The verified origin. Show it to the user. */
  audience: string;
  nonce: string;
  /** The event to sign with `created_at` set to now. */
  template: LinkauthTemplate;
  /** From the document the origin serves. */
  domain: {
    name: string;
    icon: string | null;
    pubkey: string;
    relays: string[];
  };
  delivery: /** Navigate to `buildCallbackUrl(url, …)`; `url` is listed in the document. */
    | { kind: "callback"; url: string }
    /** Publish `wrapAssertion(signed, pubkey)` to `relays`. */
    | { kind: "nostr"; pubkey: string; relays: string[] };
}

export type ResolveLinkauthResult =
  | { ok: true; login: LinkauthLogin }
  | {
      ok: false;
      reason:
        | "not-a-linkauth-link"
        /** It starts like a linkauth link but a parameter is missing or invalid. */
        | "malformed-link"
        /** The origin's document could not be loaded or validated: `detail` says why. */
        | "unverified-domain"
        /** The link's `cb` is not one of the document's callbacks. */
        | "callback-not-listed";
      detail?: DomainFailure;
    };

const linkFragment = (text: string): string => {
  const trimmed = text.trim();
  const hash = trimmed.indexOf("#");
  return hash === -1 ? trimmed : trimmed.slice(hash + 1);
};

/** Whether `text` (a URL or just its fragment) is a signer link, valid or not. */
export const isLinkauthLink = (text: string): boolean =>
  linkFragment(text).startsWith(LINK_PREFIX);

const single = (params: URLSearchParams, key: string): string | null => {
  const values = params.getAll(key);
  return values.length === 1 ? (values[0] ?? null) : null;
};

/**
 * Parses `https://<signer>/#linkauth?o=<origin>&n=<nonce>[&cb=<callback>]`
 * (or just its fragment) without any network access. Returns `null` for a
 * repeated parameter, an origin that is not exactly a normalized origin, a
 * bad nonce, or a `cb` that is not a plain URL on that origin. The site is
 * not verified yet: use `resolveLinkauthLink`.
 */
export const parseLinkauthLink = (text: string): LinkauthLink | null => {
  const fragment = linkFragment(text);
  if (!fragment.startsWith(LINK_PREFIX)) return null;
  const params = new URLSearchParams(fragment.slice(LINK_PREFIX.length));
  const origin = single(params, "o");
  const nonce = single(params, "n");
  if (origin === null || nonce === null || !isNonce(nonce)) return null;
  if (normalizeAudience(origin) !== origin) return null;
  if (!params.has("cb")) return { audience: origin, nonce, callback: null };
  const callback = plainCallback(origin, single(params, "cb"));
  return callback === null ? null : { audience: origin, nonce, callback };
};

/**
 * Parses a signer link and verifies the site behind it: loads the origin's
 * domain document and, for a same-device link, requires `cb` to be one of
 * its callbacks. Fails closed: whatever cannot be verified is refused.
 * Never throws.
 */
export const resolveLinkauthLink = async (
  text: string,
  options: FetchDomainOptions = {},
): Promise<ResolveLinkauthResult> => {
  const link = parseLinkauthLink(text);
  if (link === null) {
    return {
      ok: false,
      reason: isLinkauthLink(text) ? "malformed-link" : "not-a-linkauth-link",
    };
  }
  const fetched = await fetchDomainDocument(link.audience, options);
  if (!fetched.ok) {
    return { ok: false, reason: "unverified-domain", detail: fetched.reason };
  }
  const { callbacks, ...domain } = fetched.domain;
  if (link.callback !== null && !callbacks.includes(link.callback)) {
    return { ok: false, reason: "callback-not-listed" };
  }
  return {
    ok: true,
    login: {
      audience: link.audience,
      nonce: link.nonce,
      template: authTemplate({ audience: link.audience, nonce: link.nonce }),
      domain,
      delivery:
        link.callback === null
          ? { kind: "nostr", pubkey: domain.pubkey, relays: domain.relays }
          : { kind: "callback", url: link.callback },
    },
  };
};

/**
 * The URL to send the user back to: the callback with the signed event, or
 * `"denied"`, in its fragment so it stays out of server logs. Pass the `url`
 * of a callback delivery, which `resolveLinkauthLink` has checked against the
 * site's document; throws `TypeError` for anything that is not an acceptable
 * site URL.
 */
export const buildCallbackUrl = (
  callback: string,
  result: LinkauthAssertion | "denied",
): string => {
  if (normalizeAudience(callback) === null) {
    throw new TypeError("linkauth: invalid callback");
  }
  const url = new URL(callback);
  url.hash =
    result === "denied"
      ? `${ERROR_KEY}=denied`
      : `${RESULT_KEY}=${encodeAssertion(result)}`;
  return url.toString();
};
