import type {
  LinkauthLogin,
  ResolveLinkauthResult,
} from "@linky-fit/linkauth/signer";
import {
  linkauthAudience,
  requestsDeviceAuthorization,
  type NostrConnectRequest,
} from "@linky-fit/linkstr";
import { safeDecodeURIComponent } from "./utils/url";

/** A login Linky can approve: a foreign signer's relay request, or a site it verified. */
export type SiteLoginRequest =
  | { channel: "relay"; request: NostrConnectRequest }
  | { channel: "linkauth"; login: LinkauthLogin };

/**
 * Why a login is not offered for approval: a `#linkauth` link that fails its
 * check, or a relay login to an origin that publishes a domain document.
 */
export type SiteLoginRefusal =
  | Exclude<
      Extract<ResolveLinkauthResult, { ok: false }>["reason"],
      "not-a-linkauth-link"
    >
  | "linkauth-available";

/** What the login dialog shows: a login to approve, or one still being checked or refused. */
export type PendingSiteLogin =
  | SiteLoginRequest
  | { channel: "checking"; origin: string }
  | { channel: "refused"; origin: string | null; reason: SiteLoginRefusal };

export interface SiteLoginTerms {
  /** The origin the login is bound to; null when Linky would not sign this request. */
  audience: string | null;
  /** The site's own claim, from its domain document or a foreign signer's request; never verified. */
  name: string | null;
  image: string | null;
  /** This origin published a domain document and Linky loaded it from the origin. */
  verified: boolean;
  linksDevice: boolean;
  /** Approving answers a login shown on another screen, which anyone can display. */
  fromOtherScreen: boolean;
}

export const describeSiteLogin = (login: SiteLoginRequest): SiteLoginTerms => {
  if (login.channel === "linkauth") {
    const { audience, delivery, domain } = login.login;
    return {
      audience,
      name: domain.name,
      image: domain.icon,
      verified: true,
      linksDevice: false,
      fromOtherScreen: delivery.kind === "nostr",
    };
  }
  const { image, name } = login.request;
  return {
    audience: linkauthAudience(login.request),
    name: name?.trim() || null,
    image,
    verified: false,
    linksDevice: requestsDeviceAuthorization(login.request),
    fromOtherScreen: true,
  };
};

const NOSTR_CONNECT_URI = /^nostrconnect:/i;
const ENCODED_NOSTR_CONNECT_URI = /^nostrconnect%3a/i;
const LINKAUTH_HASH = /^#linkauth\?/;

/** Reads the URI from a `#nostrconnect://…` web link, raw or percent-encoded. */
export const readNostrConnectUriFromHash = (hash: string): string | null => {
  const value = hash.replace(/^#/, "").trim();
  if (NOSTR_CONNECT_URI.test(value)) return value;
  if (!ENCODED_NOSTR_CONNECT_URI.test(value)) return null;
  const decoded = safeDecodeURIComponent(value);
  return NOSTR_CONNECT_URI.test(decoded) ? decoded : null;
};

/** A `#linkauth?…` web link, with the fragment kept as the signer parses it. */
const readLinkauthLinkFromHash = (hash: string): string | null =>
  LINKAUTH_HASH.test(hash) ? hash.slice(1) : null;

/**
 * Takes a site's login link out of the address bar and its history entry:
 * a `#nostrconnect://…` URI or a `#linkauth?…` link. Sites put them
 * in the hash so the secret or nonce never reaches a server log or Referer.
 */
export const takeSiteLoginHashLink = (): string | null => {
  const { hash } = window.location;
  const link =
    readNostrConnectUriFromHash(hash) ?? readLinkauthLinkFromHash(hash);
  if (link) {
    const { pathname, search } = window.location;
    window.history.replaceState(null, "", `${pathname}${search}#wallet`);
  }
  return link;
};
