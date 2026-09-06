import { parseTokenText } from "@linky/linkshu";
import { normalizeNpubIdentifier } from "./nostrNpub";
import { safeDecodeURIComponent } from "./url";

interface NativeDeepLinkScanText {
  kind: "scan-text";
  rawUrl: string;
  text: string;
}

const NOSTR_SCHEME_PREFIX = /^nostr:(\/\/)?/i;
const CASHU_SCHEME_PREFIX = /^cashu:(\/\/)?/i;

const normalizeCandidate = (value: string): string => {
  return safeDecodeURIComponent(value).trim();
};

const normalizeStrictNpub = (value: string): string | null => {
  const normalized = normalizeNpubIdentifier(value);
  if (!normalized) return null;
  return /^npub1/i.test(normalized) ? normalized.toLowerCase() : null;
};

const normalizeStrictCashuToken = (value: string): string | null => {
  const trimmed = normalizeCandidate(value);
  if (!trimmed) return null;
  const normalized = trimmed.replace(/^cashu/i, "cashu");
  return parseTokenText(normalized) ? normalized : null;
};

export const buildCashuDeepLink = (rawToken: string): string | null => {
  const token = normalizeStrictCashuToken(rawToken);
  if (!token) return null;
  return `cashu://${token}`;
};

export const buildCashuShareUrl = (rawToken: string): string | null => {
  const token = normalizeStrictCashuToken(rawToken);
  if (!token) return null;
  return `https://linky.fit/cashu/#${encodeURIComponent(token)}`;
};

const extractNpubFromCandidate = (value: string): string | null => {
  const trimmed = normalizeCandidate(value);
  if (!trimmed) return null;

  const direct = normalizeStrictNpub(trimmed);
  if (direct) return direct;

  const segments = trimmed
    .split("/")
    .map((segment) => normalizeCandidate(segment))
    .filter(Boolean);

  if (segments.length === 0) return null;

  const head = (segments[0] ?? "").toLowerCase();
  if ((head === "contact" || head === "npub") && segments.length > 1) {
    return normalizeStrictNpub(segments[1] ?? "");
  }

  return normalizeStrictNpub(segments[0] ?? "");
};

interface DeepLinkLocation {
  readonly host: string;
  readonly segments: readonly string[];
}

const collectCandidatesFromUrl = (
  rawUrl: string,
  scheme: "cashu" | "nostr",
  schemePrefix: RegExp,
  queryKeys: readonly string[],
  collectLocationCandidates: (location: DeepLinkLocation) => readonly string[],
): string[] => {
  const candidates: string[] = [];

  try {
    const url = new URL(rawUrl);
    if (url.protocol.toLowerCase() !== `${scheme}:`) {
      return [];
    }

    for (const key of queryKeys) {
      const queryValue = normalizeCandidate(url.searchParams.get(key) ?? "");
      if (queryValue) {
        candidates.push(queryValue);
      }
    }

    const host = normalizeCandidate(url.host);
    const segments = url.pathname
      .split("/")
      .map((segment) => normalizeCandidate(segment))
      .filter(Boolean);

    candidates.push(...collectLocationCandidates({ host, segments }));
  } catch {
    // ignore invalid URL parsing and fall back to manual extraction below
  }

  const withoutScheme = rawUrl.replace(schemePrefix, "").trim();
  if (withoutScheme) {
    const manualPath = withoutScheme.split("?")[0]?.trim() ?? "";
    if (manualPath) {
      candidates.push(manualPath.replace(/^\/+/, ""));
    }
  }

  return candidates;
};

const collectNostrCandidatesFromUrl = (rawUrl: string): string[] =>
  collectCandidatesFromUrl(
    rawUrl,
    "nostr",
    NOSTR_SCHEME_PREFIX,
    ["npub", "nostr", "uri"],
    ({ host, segments }) => {
      const candidates: string[] = [];
      const lowerHost = host.toLowerCase();
      const firstSegment = segments[0] ?? "";
      const lowerFirstSegment = firstSegment.toLowerCase();

      if (host) {
        candidates.push(
          (lowerHost === "contact" || lowerHost === "npub") && firstSegment
            ? firstSegment
            : host,
        );
      }

      if (
        (lowerFirstSegment === "contact" || lowerFirstSegment === "npub") &&
        segments[1]
      ) {
        candidates.push(segments[1]);
      } else if (
        firstSegment &&
        (!host || lowerHost === "contact" || lowerHost === "npub")
      ) {
        candidates.push(firstSegment);
      }

      return candidates;
    },
  );

const collectCashuCandidatesFromUrl = (rawUrl: string): string[] =>
  collectCandidatesFromUrl(
    rawUrl,
    "cashu",
    CASHU_SCHEME_PREFIX,
    ["cashu", "token", "cashutoken", "cashu_token", "uri", "t"],
    ({ host, segments }) => [host, segments[0] ?? ""].filter(Boolean),
  );

const parseNostrDeepLinkUrl = (
  normalizedRawUrl: string,
): NativeDeepLinkScanText | null => {
  for (const candidate of collectNostrCandidatesFromUrl(normalizedRawUrl)) {
    const npub = extractNpubFromCandidate(candidate);
    if (!npub) continue;
    return {
      kind: "scan-text",
      rawUrl: normalizedRawUrl,
      text: `nostr:${npub}`,
    };
  }

  return null;
};

const parseCashuDeepLinkUrl = (
  normalizedRawUrl: string,
): NativeDeepLinkScanText | null => {
  for (const candidate of collectCashuCandidatesFromUrl(normalizedRawUrl)) {
    const token = normalizeStrictCashuToken(candidate);
    if (!token) continue;
    return {
      kind: "scan-text",
      rawUrl: normalizedRawUrl,
      text: `cashu:${token}`,
    };
  }

  return null;
};

export const parseNativeDeepLinkUrl = (
  rawUrl: string,
): NativeDeepLinkScanText | null => {
  const normalizedRawUrl = rawUrl.trim();
  if (!normalizedRawUrl) {
    return null;
  }

  if (NOSTR_SCHEME_PREFIX.test(normalizedRawUrl)) {
    return parseNostrDeepLinkUrl(normalizedRawUrl);
  }

  if (CASHU_SCHEME_PREFIX.test(normalizedRawUrl)) {
    return parseCashuDeepLinkUrl(normalizedRawUrl);
  }

  return null;
};
