// Relative source imports with .js specifiers, as in lnurlp.ts: the package exports map points at .ts.
import {
  isNonce,
  normalizeAudience,
} from "../../../packages/linkauth/src/index.js";
import { createHmac, timingSafeEqual } from "node:crypto";
import { hexToBytes } from "nostr-tools/utils";
import recommendedRelays from "../public/recommended-relays.json" with { type: "json" };
import {
  getFirstQueryValue,
  setJsonProxyHeaders,
  type ApiRequest,
  type ApiResponse,
} from "./_npubcash.js";

const NONCE_COOKIE = "linky_demo_auth_nonce";
export const NONCE_TTL_SECONDS = 300;
// The cookie only travels to the demo's own endpoints.
const COOKIE_PATH = "/api/demo-auth";
const PRODUCTION_AUDIENCE = "https://linky.fit";
const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/u;

const SECRET_KEY_HEX = /^[0-9a-f]{64}$/u;
const MAX_RELAYS = 5;

export interface DemoAuthRequest extends ApiRequest {
  body?: unknown;
}

// Vercel sets VERCEL_URL, so a preview deployment is the one non-production host the client does not choose.
const previewAudience = (): string | undefined =>
  process.env.VERCEL_ENV === "preview" && process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : undefined;

/**
 * The origin assertions must be bound to: LINKY_DEMO_AUTH_AUDIENCE, else this
 * Vercel preview deployment, else the request's own origin on a loopback host
 * (local e2e), else production. Any other Host header cannot choose the audience.
 *
 * Off loopback only those three audiences exist, so another host serving the
 * demo (such as `www.linky.fit`) is not in the document's callbacks and the
 * signer refuses its links with `callback-not-listed`.
 */
const demoAudience = (req: ApiRequest): string | null => {
  const host = getFirstQueryValue(req.headers?.host) ?? "";
  const audience =
    process.env.LINKY_DEMO_AUTH_AUDIENCE ||
    previewAudience() ||
    (LOOPBACK_HOST.test(host) ? `http://${host}` : PRODUCTION_AUDIENCE);
  return normalizeAudience(audience);
};

/** The audience, or `null` after answering 500 because LINKY_DEMO_AUTH_AUDIENCE is not an acceptable origin. */
export const requireAudience = (
  req: ApiRequest,
  res: ApiResponse,
): string | null => {
  const audience = demoAudience(req);
  if (audience === null) {
    res.status(500).json({ error: "Demo audience is misconfigured" });
  }
  return audience;
};

export const nonceCookie = (
  audience: string,
  value: string,
  maxAgeSeconds: number,
): string =>
  [
    `${NONCE_COOKIE}=${value}`,
    `Path=${COOKIE_PATH}`,
    `Max-Age=${maxAgeSeconds}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(audience.startsWith("https:") ? ["Secure"] : []),
  ].join("; ");

// Keyed by a key derived from the receiving key, never the receiving key itself.
const cookieMac = (secretKey: Uint8Array, nonce: string): Buffer =>
  createHmac(
    "sha256",
    createHmac("sha256", secretKey)
      .update("linky-demo-auth-nonce-cookie")
      .digest(),
  )
    .update(nonce)
    .digest();

/** The cookie value for an issued nonce: `<nonce>.<hex MAC>`, so only nonces this server issued count. */
export const signedNonce = (secretKey: Uint8Array, nonce: string): string =>
  `${nonce}.${cookieMac(secretKey, nonce).toString("hex")}`;

/** The nonce this server issued to the request, or `null` for a missing, malformed or forged cookie. */
export const readNonceCookie = (
  req: ApiRequest,
  secretKey: Uint8Array,
): string | null => {
  const header = getFirstQueryValue(req.headers?.cookie) ?? "";
  for (const pair of header.split(";")) {
    const [name, ...rest] = pair.trim().split("=");
    const [nonce = "", mac = ""] = rest.join("=").split(".");
    if (
      name === NONCE_COOKIE &&
      isNonce(nonce) &&
      /^[0-9a-f]{64}$/u.test(mac) &&
      timingSafeEqual(Buffer.from(mac, "hex"), cookieMac(secretKey, nonce))
    ) {
      return nonce;
    }
  }
  return null;
};

export const requireMethod = (
  method: "GET" | "POST",
  req: ApiRequest,
  res: ApiResponse,
): boolean => {
  setJsonProxyHeaders(res);
  if (req.method === method) return true;
  res.setHeader("Allow", method);
  res.status(405).json({ error: "Method not allowed" });
  return false;
};

/**
 * The key that logins are delivered to. There is no default: it must be set
 * once per deployment (production and preview) as LINKY_DEMO_AUTH_SECRET_KEY,
 * 64 hex characters, for example from `openssl rand -hex 32`. Without it in
 * either environment the domain document answers 503 and Linky refuses every login.
 */
const demoReceiverKey = (): Uint8Array | null => {
  const hex = process.env.LINKY_DEMO_AUTH_SECRET_KEY ?? "";
  return SECRET_KEY_HEX.test(hex) ? hexToBytes(hex) : null;
};

/** What the domain document accepts: `wss:`, or `ws:` on a loopback origin, without credentials or a fragment. */
const isAcceptableRelay = (audience: string, value: string): boolean => {
  try {
    const url = new URL(value);
    const secure =
      url.protocol === "wss:" ||
      (url.protocol === "ws:" && audience.startsWith("http:"));
    return (
      secure && url.username === "" && url.password === "" && url.hash === ""
    );
  } catch {
    return false;
  }
};

/** LINKY_DEMO_AUTH_RELAYS (comma separated), else the recommended nostr relays; at most five the document accepts. */
const demoRelays = (audience: string): string[] => {
  const configured = (process.env.LINKY_DEMO_AUTH_RELAYS ?? "")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);
  return (configured.length > 0 ? configured : recommendedRelays.nostr)
    .filter((url) => isAcceptableRelay(audience, url))
    .slice(0, MAX_RELAYS);
};

/** The only page a same-device login may return to; the domain document lists it. */
export const demoCallback = (audience: string): string =>
  `${audience}/demo/auth/`;

/** The receiving key, or `null` after answering 503 because the demo is not set up. */
export const requireReceiverKey = (res: ApiResponse): Uint8Array | null => {
  const key = demoReceiverKey();
  if (key === null) {
    res.status(503).json({
      error: "Demo is not configured: set LINKY_DEMO_AUTH_SECRET_KEY",
    });
  }
  return key;
};

/** The relays to use, or `null` after answering 503 because none of the configured ones is acceptable. */
export const requireRelays = (
  audience: string,
  res: ApiResponse,
): string[] | null => {
  const relays = demoRelays(audience);
  if (relays.length === 0) {
    res.status(503).json({
      error:
        "Demo is not configured: LINKY_DEMO_AUTH_RELAYS has no usable relay",
    });
    return null;
  }
  return relays;
};
