import {
  decodeLnurlBech32Url,
  fetchLnurlJson,
  requireLnurlHttpsUrl,
  isLnurlErrorStatus,
  isLnurlStatusResponse,
  normalizeLnurlHttpsUrl,
  toHttpsLnurlUrl,
  type LnurlFallback,
} from "./common";
import { stripLightningPrefix } from "./lightningAddress";
import { asNonEmptyString, isHttpsUrl } from "./text";

// LUD-04 (LNURL-auth). Unlike pay and withdraw, the whole request is already in
// the scanned URL — `tag=login` plus the challenge — so a login can be told
// apart from the other tags before any network call.

const K1_PATTERN = /^[0-9a-f]{64}$/i;

const LNURL_AUTH_ACTIONS = ["auth", "link", "login", "register"] as const;
export type LnurlAuthAction = (typeof LNURL_AUTH_ACTIONS)[number];

const isLnurlAuthAction = (value: string): value is LnurlAuthAction =>
  LNURL_AUTH_ACTIONS.some((action) => action === value);

export interface LnurlAuthPreview {
  /** What the domain says the login is for; `login` when it says nothing. */
  action: LnurlAuthAction;
  /** Lowercase host the linking key is derived for, and what the user sees. */
  domain: string;
  /** 32-byte challenge, lowercase hex. */
  k1: string;
  /** The LNURL itself — LUD-04 appends `sig`/`key` to its existing query. */
  requestUrl: string;
}

export interface LnurlAuthSignature {
  /** Compressed secp256k1 linking public key, hex — LUD-04 `key`. */
  publicKeyHex: string;
  /** DER-encoded ECDSA signature over the challenge, hex — LUD-04 `sig`. */
  signatureHex: string;
}

/**
 * Signing needs the user's key, which this package never holds; the consumer
 * derives the per-domain linking key and signs the challenge it is handed.
 */
export type LnurlAuthSigner = (args: {
  challengeHex: string;
  domain: string;
}) => LnurlAuthSignature | Promise<LnurlAuthSignature>;

const normalizeLnurlAuthSchemeUrl = (value: string): string | null => {
  const normalized = stripLightningPrefix(value);
  if (!/^keyauth:\/\//i.test(normalized)) return null;

  const httpUrl = `https://${normalized.replace(/^keyauth:\/\//i, "").trim()}`;
  return isHttpsUrl(httpUrl) ? normalizeLnurlHttpsUrl(httpUrl) : null;
};

export const parseLnurlAuthTarget = (
  value: string,
): LnurlAuthPreview | null => {
  const requestUrl =
    decodeLnurlBech32Url(value) ??
    normalizeLnurlAuthSchemeUrl(value) ??
    toHttpsLnurlUrl(value);
  if (!requestUrl) return null;

  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }

  if (url.searchParams.get("tag")?.trim().toLowerCase() !== "login") {
    return null;
  }

  const k1 = url.searchParams.get("k1")?.trim() ?? "";
  if (!K1_PATTERN.test(k1)) return null;

  const action = url.searchParams.get("action")?.trim().toLowerCase() ?? "";

  return {
    action: isLnurlAuthAction(action) ? action : "login",
    domain: url.hostname.toLowerCase(),
    k1: k1.toLowerCase(),
    requestUrl,
  };
};

export const isLnurlAuthTarget = (value: string): boolean =>
  parseLnurlAuthTarget(value) !== null;

export const submitLnurlAuth = async (
  args: {
    preview: LnurlAuthPreview;
    sign: LnurlAuthSigner;
  },
  fallback?: LnurlFallback,
): Promise<void> => {
  requireLnurlHttpsUrl(args.preview.requestUrl);
  const { publicKeyHex, signatureHex } = await args.sign({
    challengeHex: args.preview.k1,
    domain: args.preview.domain,
  });

  const callbackUrl = new URL(args.preview.requestUrl);
  callbackUrl.searchParams.set("sig", signatureHex);
  callbackUrl.searchParams.set("key", publicKeyHex);

  const responseJson = await fetchLnurlJson(callbackUrl.toString(), fallback);
  if (!isLnurlStatusResponse(responseJson)) {
    throw new Error("Invalid LNURL-auth callback response");
  }

  if (isLnurlErrorStatus(responseJson.status)) {
    throw new Error(
      asNonEmptyString(responseJson.reason) ?? "LNURL-auth error",
    );
  }

  // A login the domain did not confirm must not be reported as done: the user
  // would go back to a site that never logged them in.
  if (String(responseJson.status ?? "").toUpperCase() !== "OK") {
    throw new Error("LNURL-auth was not confirmed");
  }
};
