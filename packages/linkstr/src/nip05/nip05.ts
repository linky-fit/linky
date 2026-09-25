import { Schema } from "effect";
import { RelayUrl } from "../domain/primitives";
import type { Pubkey } from "../domain/primitives";
import { parsePubkey } from "../identity/codec";

export interface Nip05Identifier {
  readonly domain: string;
  readonly identifier: string;
  readonly localPart: string;
}

export interface Nip05Resolution {
  readonly pubkey: Pubkey;
  readonly relays: ReadonlyArray<RelayUrl>;
}

const LOCAL_PART_RE = /^[a-z0-9._-]+$/i;
const DOMAIN_RE = /^[a-z0-9.-]+$/i;

const isRelayUrl = Schema.is(RelayUrl);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stripNostrPrefix = (value: string): string =>
  value.trim().replace(/^nostr:/i, "");

const looksLikeNpub = (value: string): boolean => {
  const normalized = stripNostrPrefix(value);
  const atIndex = normalized.lastIndexOf("@");
  const candidate = atIndex >= 0 ? normalized.slice(0, atIndex) : normalized;
  return /^npub1/i.test(candidate.trim());
};

const normalizeLocalPart = (value: string): string | null => {
  const localPart = value.trim().toLowerCase();
  if (!localPart || !LOCAL_PART_RE.test(localPart)) return null;
  return localPart;
};

const normalizeDomain = (value: string): string | null => {
  const domain = value.trim().toLowerCase();
  if (!domain || !DOMAIN_RE.test(domain) || domain.includes("..")) return null;
  try {
    const url = new URL(`https://${domain}`);
    return url.hostname === domain ? domain : null;
  } catch {
    return null;
  }
};

const makeIdentifier = (
  localPart: string,
  domain: string,
): Nip05Identifier => ({
  domain,
  identifier: `${localPart}@${domain}`,
  localPart,
});

export const parseNip05Identifier = (
  value: string,
  defaultDomain?: string,
): Nip05Identifier | null => {
  const input = stripNostrPrefix(value);
  if (!input || looksLikeNpub(input)) return null;

  const atIndex = input.indexOf("@");
  if (atIndex >= 0) {
    if (atIndex !== input.lastIndexOf("@")) return null;
    const localPart = normalizeLocalPart(input.slice(0, atIndex));
    const domain = normalizeDomain(input.slice(atIndex + 1));
    if (!localPart || !domain) return null;
    return makeIdentifier(localPart, domain);
  }

  if (defaultDomain === undefined) return null;
  const localPart = normalizeLocalPart(input);
  const domain = normalizeDomain(defaultDomain);
  if (!localPart || !domain) return null;
  return makeIdentifier(localPart, domain);
};

export const nip05WellKnownUrl = (identifier: Nip05Identifier): URL => {
  const url = new URL(`https://${identifier.domain}/.well-known/nostr.json`);
  url.searchParams.set("name", identifier.localPart);
  return url;
};

const readRelayHints = (
  value: unknown,
  pubkeyHex: string,
): ReadonlyArray<RelayUrl> => {
  if (!isRecord(value)) return [];
  const rawList = value[pubkeyHex];
  if (!Array.isArray(rawList)) return [];

  const relays: Array<RelayUrl> = [];
  const seen = new Set<string>();
  for (const item of rawList) {
    if (typeof item !== "string") continue;
    const relay = item.trim();
    if (!relay || !isRelayUrl(relay) || seen.has(relay)) continue;
    seen.add(relay);
    relays.push(relay);
  }
  return relays;
};

export const decodeNip05Document = (
  body: unknown,
  identifier: Nip05Identifier,
): Nip05Resolution | null => {
  if (!isRecord(body)) return null;
  const names = body.names;
  if (!isRecord(names)) return null;

  const rawPubkey = names[identifier.localPart];
  if (typeof rawPubkey !== "string") return null;

  const pubkey = parsePubkey(rawPubkey.toLowerCase());
  if (!pubkey) return null;

  return { pubkey, relays: readRelayHints(body.relays, pubkey) };
};
