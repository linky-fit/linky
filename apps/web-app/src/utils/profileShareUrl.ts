import { decodeNpub } from "@linky-fit/linkstr";
import { parseNip05IdentifierInput } from "./nostrNip05";
import { safeDecodeURIComponent } from "./url";

// Trailing slash, query and hash are tolerated so a link copied from a
// browser bar or a messenger preview still parses.
const PROFILE_SHARE_URL =
  /^https?:\/\/(?:www\.)?linky\.fit\/p\/([^/?#]+)\/?(?:[?#].*)?$/i;

export const buildProfileShareUrl = (npubOrName: string): string =>
  `https://linky.fit/p/${encodeURIComponent(npubOrName)}`;

export type ProfileShareUrlTarget =
  | { kind: "npub"; npub: string }
  | { kind: "name"; identifier: string };

/** What a linky.fit profile link points at: an npub, or a claimed name as `name@linky.fit`. */
export const parseProfileShareUrl = (
  value: string,
): ProfileShareUrlTarget | null => {
  const segment = PROFILE_SHARE_URL.exec(value.trim())?.[1];
  if (!segment) return null;

  const target = safeDecodeURIComponent(segment).trim();
  if (/^npub1/i.test(target)) {
    const npub = target.toLowerCase();
    return decodeNpub(npub) ? { kind: "npub", npub } : null;
  }

  const identifier = parseNip05IdentifierInput(target);
  return identifier
    ? { kind: "name", identifier: identifier.identifier }
    : null;
};

/** A pasted profile link searches as the identifier it carries; anything else searches as typed. */
export const normalizeContactSearchQuery = (value: string): string => {
  const target = parseProfileShareUrl(value);
  if (!target) return value.trim();
  return target.kind === "npub" ? target.npub : target.identifier;
};
