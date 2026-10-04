import type { NostrConnectRequest } from "@linky-fit/linkstr";
import { safeDecodeURIComponent } from "./utils/url";
export { parseNostrConnectUri } from "@linky-fit/linkstr";
export type { NostrConnectRequest } from "@linky-fit/linkstr";

const NOSTR_CONNECT_URI = /^nostrconnect:/i;
const ENCODED_NOSTR_CONNECT_URI = /^nostrconnect%3a/i;

const hostOf = (url: string | null): string | null => {
  if (!url) return null;
  try {
    return new URL(url).host || null;
  } catch {
    return null;
  }
};

/** How the site names itself; both parts are claims nobody verified. */
export const describeNostrConnectSite = (
  request: NostrConnectRequest,
): { host: string | null; label: string | null } => {
  const host = hostOf(request.url);
  return { host, label: request.name?.trim() || host };
};

/**
 * Reads the URI from a `#nostrconnect://…` web link, raw or percent-encoded.
 * Sites put it in the hash so the secret never reaches a server log or Referer.
 */
export const readNostrConnectUriFromHash = (hash: string): string | null => {
  const value = hash.replace(/^#/, "").trim();
  if (NOSTR_CONNECT_URI.test(value)) return value;
  if (!ENCODED_NOSTR_CONNECT_URI.test(value)) return null;
  const decoded = safeDecodeURIComponent(value);
  return NOSTR_CONNECT_URI.test(decoded) ? decoded : null;
};

/** Takes a web link's URI out of the address bar and its history entry. */
export const takeNostrConnectHashLink = (): string | null => {
  const uri = readNostrConnectUriFromHash(window.location.hash);
  if (uri) {
    const { pathname, search } = window.location;
    window.history.replaceState(null, "", `${pathname}${search}#wallet`);
  }
  return uri;
};
