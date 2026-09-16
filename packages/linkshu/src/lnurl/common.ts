import { bech32 } from "@scure/base";
import { Schema } from "effect";
import { stripLightningPrefix } from "./lightningAddress";
import { isHttpsUrl } from "./text";

/**
 * Browsers cannot reach every LNURL server directly (CORS), so a consumer may
 * hand in a proxy to retry through when the direct request fails.
 */
export type LnurlFallback = (url: string) => Promise<Response>;

const LnurlStatusResponse = Schema.Struct({
  reason: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String),
});
export const isLnurlStatusResponse = Schema.is(LnurlStatusResponse);

/** Every LNURL response may be an error instead, whatever the tag asked for. */
export const isLnurlErrorStatus = (status: string | undefined): boolean =>
  String(status ?? "").toUpperCase() === "ERROR";

// Some LNURL encoders ship URLs with empty path segments (e.g.
// `https://lnbits.cz/lnurlp//AVH9zJ`). Most servers respond 404 to the empty
// segment but answer the same content under the collapsed path. Mirror the
// behavior of other LNURL wallets by collapsing consecutive slashes in the
// path while leaving the `://` authority and the query/fragment untouched.
export const normalizeLnurlHttpsUrl = (value: string): string => {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return value;
    const collapsedPath = url.pathname.replace(/\/{2,}/g, "/");
    if (collapsedPath !== url.pathname) {
      url.pathname = collapsedPath;
    }
    return url.toString();
  } catch {
    return value;
  }
};

export const decodeLnurlBech32Url = (value: string): string | null => {
  const normalized = stripLightningPrefix(value);
  if (!/^lnurl1/i.test(normalized)) return null;

  try {
    const decoded = bech32.decodeUnsafe(normalized.toLowerCase(), 2048);
    if (!decoded) return null;
    const bytes = Uint8Array.from(bech32.fromWords(decoded.words));
    const text = new TextDecoder().decode(bytes).trim();
    if (!isHttpsUrl(text)) return null;
    return normalizeLnurlHttpsUrl(text);
  } catch {
    return null;
  }
};

export const toHttpsLnurlUrl = (value: string): string | null => {
  const normalized = stripLightningPrefix(value);
  if (!isHttpsUrl(normalized)) return null;
  return normalized;
};

class InsecureLnurlUrlError extends Error {
  public constructor() {
    super("LNURL URLs must use HTTPS");
  }
}

export const requireLnurlHttpsUrl = (url: string): void => {
  if (!isHttpsUrl(url)) throw new InsecureLnurlUrlError();
};

const fetchJson = async (url: string) => {
  let requestUrl = url;
  for (let redirects = 0; ; redirects += 1) {
    requireLnurlHttpsUrl(requestUrl);
    const response = await fetch(requestUrl, {
      headers: { Accept: "application/json" },
      redirect: "manual",
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("Location");
      await response.body?.cancel();
      if (!location || redirects === 3) {
        throw new Error("Invalid or excessive LNURL redirects");
      }
      requestUrl = new URL(location, requestUrl).toString();
      continue;
    }
    // Browsers hide manual redirects; the HTTPS-enforcing proxy handles them.
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body: unknown = await response.json();
    return body;
  }
};

export const fetchLnurlJson = async (url: string, fallback?: LnurlFallback) => {
  requireLnurlHttpsUrl(url);
  try {
    return await fetchJson(url);
  } catch (error) {
    if (!fallback || error instanceof InsecureLnurlUrlError) throw error;
    const response = await fallback(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body: unknown = await response.json();
    return body;
  }
};
