import {
  Amount as CashuAmount,
  getDecodedToken,
  getEncodedToken,
  getTokenMetadata,
} from "@cashu/cashu-ts";
import { Schema } from "effect";
import {
  Amount,
  CurrencyUnit,
  parseMintUrl,
  TokenText,
} from "../domain/primitives";
import { DecodedToken, ParsedToken } from "./domain";
import {
  decodeTokenFields,
  decodeV3Payload,
  legacyBundleToV3TokenText,
} from "./internal/v3Json";

/**
 * The one token codec in linky. Handles v3 (`cashuA`, base64url JSON), v4
 * (`cashuB`, base64url CBOR), and legacy cashu.me plain-JSON proof bundles,
 * which are normalized to standard token text.
 *
 * All functions are pure and total: malformed input yields `null`, never a
 * throw.
 */

const V3_PREFIX = "cashuA";

/** Normalizes any supported encoding (including legacy JSON) to token text. */
export const normalizeTokenText = (raw: string): TokenText | null => {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Internal whitespace is rejected rather than passed through: cashu-ts's
  // forgiving base64 would decode it, and whitespace-y text must not become
  // the stored/dedup token identity. `extractTokenText` compacts and retries.
  if (trimmed.startsWith("cashu")) {
    return /\s/.test(trimmed) ? null : TokenText.make(trimmed);
  }
  const legacy = legacyBundleToV3TokenText(trimmed);
  return legacy === null ? null : TokenText.make(legacy);
};

const decodeAmount = Schema.decodeUnknownOption(Amount);
const decodeCurrencyUnit = Schema.decodeUnknownOption(CurrencyUnit);

/** Summary metadata (amount, mint, unit, memo) without exposing proofs. */
export const parseTokenText = (raw: string): ParsedToken | null => {
  const text = normalizeTokenText(raw);
  if (text === null) return null;
  try {
    const metadata = getTokenMetadata(text);
    const amount = decodeAmount(metadata.amount.toNumber());
    if (amount._tag === "None") return null;
    const unit = decodeCurrencyUnit(metadata.unit);
    return new ParsedToken({
      amount: amount.value,
      mint: parseMintUrl(metadata.mint),
      unit: unit._tag === "Some" ? unit.value : null,
      memo: metadata.memo ?? null,
    });
  } catch {
    return null;
  }
};

/**
 * v4 tokens carrying short v2 keyset ids cannot be expanded without the
 * mint's keyset list; without `keysetIds` they parse (`parseTokenText`) but
 * decode to `null`.
 */
const decodeViaCashuTs = (
  text: string,
  keysetIds: readonly string[],
): DecodedToken | null => {
  try {
    const token = getDecodedToken(text, keysetIds);
    const mint = parseMintUrl(token.mint);
    if (mint === null) return null;
    return decodeTokenFields({
      mint,
      unit: token.unit ?? "sat",
      memo: token.memo ?? null,
      proofs: token.proofs.map((proof) => ({
        id: proof.id,
        amount: proof.amount.toNumber(),
        secret: proof.secret,
        C: proof.C,
      })),
    });
  } catch {
    return null;
  }
};

/**
 * Full decode; `null` for malformed, proof-less, or multi-mint tokens.
 * `keysetIds` (full keyset id strings from the mint) are only needed to
 * expand short v2 keyset ids in v4 tokens.
 */
export const decodeTokenText = (
  raw: string,
  keysetIds: readonly string[] = [],
): DecodedToken | null => {
  const text = normalizeTokenText(raw);
  if (text === null) return null;
  if (text.startsWith(V3_PREFIX)) {
    return decodeV3Payload(text.slice(V3_PREFIX.length));
  }
  return decodeViaCashuTs(text, keysetIds);
};

/** Canonical v4 encoding; roundtrips with `decodeTokenText` by construction. */
export const encodeToken = (token: DecodedToken): TokenText =>
  TokenText.make(
    getEncodedToken({
      mint: token.mint,
      unit: token.unit,
      proofs: token.proofs.map((proof) => ({
        id: proof.id,
        amount: CashuAmount.from(proof.amount),
        secret: proof.secret,
        C: proof.C,
      })),
      ...(token.memo === null ? {} : { memo: token.memo }),
    }),
  );

const TOKEN_QUERY_KEYS = ["token", "cashu", "cashutoken", "cashu_token", "t"];
const CASHU_SCHEME_PREFIX = /^(web\+)?cashu:(\/\/)?/i;
const TOKEN_PATTERN = /cashu[0-9A-Za-z_-]+={0,2}/gi;

const lowercaseCashuPrefix = (value: string): string =>
  value.replace(/^cashu/i, "cashu");

const decodeUriComponentSafe = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const tryTokenCandidate = (value: string): TokenText | null => {
  const candidate = value.trim();
  if (!candidate) return null;
  const normalized = normalizeTokenText(lowercaseCashuPrefix(candidate));
  if (normalized === null) return null;
  return parseTokenText(normalized) === null ? null : normalized;
};

const searchTokenInText = (value: string): TokenText | null => {
  const raw = value.trim();
  if (!raw) return null;

  const stripped = raw
    .replace(CASHU_SCHEME_PREFIX, "")
    .replace(/^nostr:/i, "")
    .replace(/^lightning:/i, "")
    .trim();

  const direct = tryTokenCandidate(stripped);
  if (direct) return direct;

  for (const match of stripped.matchAll(TOKEN_PATTERN)) {
    const candidate = tryTokenCandidate(match[0]);
    if (candidate) return candidate;
  }

  const compact = stripped.replace(/\s+/g, "");
  if (compact && compact !== stripped) {
    const compactDirect = tryTokenCandidate(compact);
    if (compactDirect) return compactDirect;
    for (const match of compact.matchAll(TOKEN_PATTERN)) {
      const candidate = tryTokenCandidate(match[0]);
      if (candidate) return candidate;
    }
  }

  const queryIndex = stripped.indexOf("?");
  if (queryIndex >= 0 && queryIndex < stripped.length - 1) {
    const params = new URLSearchParams(stripped.slice(queryIndex + 1));
    for (const key of TOKEN_QUERY_KEYS) {
      const queryValue = params.get(key);
      if (!queryValue) continue;
      const found = searchTokenInText(queryValue);
      if (found) return found;
    }
  }

  if (/^https?:\/\//i.test(stripped)) {
    try {
      const url = new URL(stripped);
      for (const key of TOKEN_QUERY_KEYS) {
        const queryValue = url.searchParams.get(key);
        if (!queryValue) continue;
        const found = searchTokenInText(decodeUriComponentSafe(queryValue));
        if (found) return found;
      }

      const hash = url.hash.replace(/^#/, "");
      if (hash) {
        const found = searchTokenInText(decodeUriComponentSafe(hash));
        if (found) return found;
      }

      const host = decodeUriComponentSafe(url.host.trim());
      if (host) {
        const found = searchTokenInText(host);
        if (found) return found;
      }

      for (const segment of url.pathname.split("/")) {
        const decoded = decodeUriComponentSafe(segment.trim());
        if (!decoded) continue;
        const found = searchTokenInText(decoded);
        if (found) return found;
      }
    } catch {
      // not a parseable url; keep trying the remaining strategies
    }
  }

  const tokenField = stripped.match(/"token"\s*:\s*"([^"]+)"/i);
  if (tokenField?.[1]) {
    const found = searchTokenInText(decodeUriComponentSafe(tokenField[1]));
    if (found) return found;
  }

  const firstBrace = stripped.indexOf("{");
  const lastBrace = stripped.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const candidate = tryTokenCandidate(
      stripped.slice(firstBrace, lastBrace + 1),
    );
    if (candidate) return candidate;
  }

  return null;
};

/**
 * Finds a token inside arbitrary scanned/pasted text: bare tokens,
 * `cashu:`/`web+cashu:`/`lightning:` schemes, URLs carrying the token in
 * query parameters, hash, or path segments, and embedded legacy JSON.
 */
export const extractTokenText = (text: string): TokenText | null => {
  const raw = text.trim();
  if (!raw) return null;
  const found = searchTokenInText(raw);
  if (found) return found;
  if (/%[0-9A-Fa-f]{2}/.test(raw)) {
    try {
      return searchTokenInText(decodeURIComponent(raw));
    } catch {
      return null;
    }
  }
  return null;
};
