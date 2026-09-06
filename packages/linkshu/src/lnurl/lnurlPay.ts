import {
  isLightningAddress,
  stripLightningPrefix,
  getLightningAddressRequestUrl,
} from "./lightningAddress";
export { isLightningAddress } from "./lightningAddress";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  getLightningInvoiceDescriptionHashHex,
  parseBolt11AmountMsat,
} from "../invoice/preview";
import { bytesToHex } from "@noble/hashes/utils.js";
import { bech32 } from "@scure/base";
import { Schema } from "effect";
import { isRecord, asNonEmptyString, isHttpUrl } from "./text";
export type LnurlFallback = (url: string) => Promise<Response>;

// How far a fixed-amount LNURL's fresh quote may drift from the confirmed
// amount and still be paid without re-confirmation (fiat re-quotes, rounding).
const FIXED_AMOUNT_REQUOTE_TOLERANCE = 0.02;

const LnurlPayRequest = Schema.Struct({
  callback: Schema.optional(Schema.String),
  commentAllowed: Schema.optional(Schema.Number),
  maxSendable: Schema.optional(Schema.Number),
  metadata: Schema.optional(Schema.String),
  minSendable: Schema.optional(Schema.Number),
  reason: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String),
  tag: Schema.optional(Schema.String),
});
const isLnurlPayRequest = Schema.is(LnurlPayRequest);

const LnurlInvoiceResponse = Schema.Struct({
  paymentRequest: Schema.optional(Schema.String),
  pr: Schema.optional(Schema.String),
  reason: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String),
  successAction: Schema.optional(Schema.Unknown),
});
const isLnurlInvoiceResponse = Schema.is(LnurlInvoiceResponse);

interface LnurlPaySuccessActionMessage {
  message: string;
  tag: "message";
}

interface LnurlPaySuccessActionUrl {
  description: string | null;
  tag: "url";
  url: string;
}

export type LnurlPaySuccessAction =
  | LnurlPaySuccessActionMessage
  | LnurlPaySuccessActionUrl;

export interface LnurlPayInvoiceResult {
  lightningAddress: string | null;
  pr: string;
  successAction: LnurlPaySuccessAction | null;
}

const LnurlWithdrawRequest = Schema.Struct({
  callback: Schema.optional(Schema.String),
  defaultDescription: Schema.optional(Schema.String),
  k1: Schema.optional(Schema.String),
  maxWithdrawable: Schema.optional(Schema.Number),
  minWithdrawable: Schema.optional(Schema.Number),
  reason: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String),
  tag: Schema.optional(Schema.String),
});
const isLnurlWithdrawRequest = Schema.is(LnurlWithdrawRequest);

const LnurlWithdrawCallbackResponse = Schema.Struct({
  reason: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String),
});
const isLnurlWithdrawCallbackResponse = Schema.is(
  LnurlWithdrawCallbackResponse,
);

export interface LnurlWithdrawPreview {
  amountSat: number;
  callback: string;
  description: string | null;
  k1: string;
  maxAmountSat: number;
  minAmountSat: number;
  target: string;
}

export interface LnurlPayPreview {
  callback: string;
  commentAllowed: number;
  description: string | null;
  lightningAddress: string | null;
  maxSendableMsat: number;
  maxSendableSat: number;
  metadataRaw: string | null;
  minSendableMsat: number;
  minSendableSat: number;
  target: string;
}

export class LnurlTagMismatchError extends Error {
  public readonly tag: string;

  public constructor(tag: string) {
    super(`Unexpected LNURL tag: ${tag || "unknown"}`);
    this.name = "LnurlTagMismatchError";
    this.tag = tag;
  }
}

const isKnownLnurlTag = (
  value: string | undefined,
  expected: string,
): boolean => {
  return (
    String(value ?? "")
      .trim()
      .toLowerCase() === expected.toLowerCase()
  );
};

// Some LNURL encoders ship URLs with empty path segments (e.g.
// `https://lnbits.cz/lnurlp//AVH9zJ`). Most servers respond 404 to the empty
// segment but answer the same content under the collapsed path. Mirror the
// behavior of other LNURL wallets by collapsing consecutive slashes in the
// path while leaving the `://` authority and the query/fragment untouched.
const normalizeLnurlHttpUrl = (value: string): string => {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return value;
    const collapsedPath = url.pathname.replace(/\/{2,}/g, "/");
    if (collapsedPath !== url.pathname) {
      url.pathname = collapsedPath;
    }
    return url.toString();
  } catch {
    return value;
  }
};

const decodeLnurlBech32Url = (value: string): string | null => {
  const normalized = stripLightningPrefix(value);
  if (!/^lnurl1/i.test(normalized)) return null;

  try {
    const decoded = bech32.decodeUnsafe(normalized.toLowerCase(), 2048);
    if (!decoded) return null;
    const bytes = Uint8Array.from(bech32.fromWords(decoded.words));
    const text = new TextDecoder().decode(bytes).trim();
    if (!isHttpUrl(text)) return null;
    return normalizeLnurlHttpUrl(text);
  } catch {
    return null;
  }
};

const normalizeLnurlSchemeUrl = (value: string): string | null => {
  const normalized = stripLightningPrefix(value);
  if (!/^lnurlp:\/\//i.test(normalized)) return null;

  const rawTarget = normalized.replace(/^lnurlp:\/\//i, "").trim();
  if (isLightningAddress(rawTarget)) {
    return getLightningAddressRequestUrl(rawTarget);
  }

  const httpUrl = `https://${rawTarget}`;
  return isHttpUrl(httpUrl) ? httpUrl : null;
};

const normalizeLnurlWithdrawSchemeUrl = (value: string): string | null => {
  const normalized = stripLightningPrefix(value);
  if (!/^lnurlw:\/\//i.test(normalized)) return null;

  const rawTarget = normalized.replace(/^lnurlw:\/\//i, "").trim();
  const httpUrl = `https://${rawTarget}`;
  return isHttpUrl(httpUrl) ? httpUrl : null;
};

const toHttpLnurlUrl = (value: string): string | null => {
  const normalized = stripLightningPrefix(value);
  if (!isHttpUrl(normalized)) return null;
  return normalized;
};

const resolveLnurlTargetUrlOrNull = (value: string): string | null => {
  const normalized = stripLightningPrefix(value);

  if (isLightningAddress(normalized)) {
    return getLightningAddressRequestUrl(normalized);
  }

  return (
    decodeLnurlBech32Url(normalized) ??
    normalizeLnurlSchemeUrl(normalized) ??
    toHttpLnurlUrl(normalized)
  );
};

const resolveAnyLnurlTargetUrlOrNull = (value: string): string | null => {
  const normalized = stripLightningPrefix(value);

  if (isLightningAddress(normalized)) {
    return getLightningAddressRequestUrl(normalized);
  }

  return (
    decodeLnurlBech32Url(normalized) ??
    normalizeLnurlSchemeUrl(normalized) ??
    normalizeLnurlWithdrawSchemeUrl(normalized) ??
    toHttpLnurlUrl(normalized)
  );
};

const inferLightningAddressFromRequestUrl = (
  requestUrl: string,
): string | null => {
  try {
    const url = new URL(requestUrl);
    const pathSegments = url.pathname
      .split("/")
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment));

    if (
      pathSegments.length >= 3 &&
      pathSegments[0] === ".well-known" &&
      pathSegments[1].toLowerCase() === "lnurlp"
    ) {
      return `${pathSegments[2]}@${url.host}`;
    }

    return null;
  } catch {
    return null;
  }
};

export const isLnurlPayTarget = (value: string): boolean => {
  return resolveLnurlTargetUrlOrNull(value) !== null;
};

export const resolveLnurlPayRequestUrl = (value: string): string => {
  const httpUrl = resolveLnurlTargetUrlOrNull(value);
  if (httpUrl) return httpUrl;

  throw new Error("Invalid LNURL or lightning address");
};

export const getLnurlPayDisplayText = (value: string): string => {
  const normalized = stripLightningPrefix(value);
  if (isLightningAddress(normalized)) return normalized;

  const requestUrl = resolveLnurlTargetUrlOrNull(normalized);
  if (!requestUrl) return normalized;

  try {
    const url = new URL(requestUrl);
    const path = url.pathname === "/" ? "" : url.pathname;
    return `${url.host}${path}`;
  } catch {
    return requestUrl;
  }
};

export const inferLightningAddressFromLnurlTarget = (
  value: string,
): string | null => {
  const normalized = stripLightningPrefix(value);
  if (isLightningAddress(normalized)) return normalized;

  const requestUrl = resolveLnurlTargetUrlOrNull(normalized);
  if (!requestUrl) return null;

  return inferLightningAddressFromRequestUrl(requestUrl);
};

const parseLnurlPaySuccessAction = (
  value: unknown,
): LnurlPaySuccessAction | null => {
  if (!isRecord(value)) return null;
  const tag = String(value.tag ?? "")
    .trim()
    .toLowerCase();

  if (tag === "message") {
    const message = asNonEmptyString(value.message);
    if (!message) return null;
    return { tag: "message", message };
  }

  if (tag === "url") {
    const url = asNonEmptyString(value.url);
    if (!url) return null;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        return null;
      }
    } catch {
      return null;
    }
    return {
      tag: "url",
      url,
      description: asNonEmptyString(value.description) ?? null,
    };
  }

  // Other LUD-09 tags (e.g. "aes") are intentionally not surfaced here. The
  // caller can fall back to a generic "Paid" message; we only render the
  // tags we know how to display safely.
  return null;
};

const fetchJson = async (url: string) => {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body: unknown = await response.json();
  return body;
};

const fetchLnurlJson = async (url: string, fallback?: LnurlFallback) => {
  try {
    return await fetchJson(url);
  } catch (error) {
    if (!fallback) throw error;
    const response = await fallback(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body: unknown = await response.json();
    return body;
  }
};

interface ParsedLnurlPayMetadata {
  description: string | null;
  lightningAddress: string | null;
}

const parseLnurlPayMetadata = (
  metadata: string | null,
): ParsedLnurlPayMetadata | null => {
  if (!metadata) return null;
  try {
    const parsed: unknown = JSON.parse(metadata);
    if (!Array.isArray(parsed)) return null;
    let hasTextPlain = false;
    let description: string | null = null;
    let lightningAddress: string | null = null;
    for (const entry of parsed) {
      if (!Array.isArray(entry) || entry.length < 2) continue;
      const [mime, value] = entry;
      if (typeof mime !== "string" || typeof value !== "string") continue;
      const normalizedMime = mime.trim().toLowerCase();
      if (normalizedMime === "text/plain") {
        hasTextPlain = true;
        const trimmed = value.trim();
        if (trimmed && description === null) description = trimmed;
      } else if (normalizedMime === "text/identifier") {
        const trimmed = value.trim();
        if (lightningAddress === null && isLightningAddress(trimmed)) {
          lightningAddress = trimmed;
        }
      }
    }
    return hasTextPlain ? { description, lightningAddress } : null;
  } catch {
    return null;
  }
};

const sha256HexFromString = (input: string): string =>
  bytesToHex(sha256(new TextEncoder().encode(input)));

export const fetchLnurlPayPreview = async (
  paymentTarget: string,
  fallback?: LnurlFallback,
): Promise<LnurlPayPreview> => {
  const requestUrl = resolveLnurlPayRequestUrl(paymentTarget);
  const payReqJson = await fetchLnurlJson(requestUrl, fallback);
  if (!isLnurlPayRequest(payReqJson)) {
    throw new Error("Invalid LNURL pay response");
  }
  const payReq = payReqJson;

  // An LNURL error response carries no tag, so report the server's reason
  // before the tag check turns it into a misleading tag-mismatch error.
  if (String(payReq.status ?? "").toUpperCase() === "ERROR") {
    throw new Error(asNonEmptyString(payReq.reason) ?? "LNURL error");
  }

  const tag = String(payReq.tag ?? "").trim();
  const looksLikePayRequest =
    asNonEmptyString(payReq.callback) !== null &&
    Number.isFinite(Number(payReq.minSendable ?? NaN)) &&
    Number.isFinite(Number(payReq.maxSendable ?? NaN));

  if (!looksLikePayRequest && !isKnownLnurlTag(tag, "payRequest")) {
    throw new LnurlTagMismatchError(tag);
  }

  const callback = asNonEmptyString(payReq.callback);
  if (!callback) throw new Error("LNURL callback missing");

  const minSendableMsat = Number(payReq.minSendable ?? NaN);
  const maxSendableMsat = Number(payReq.maxSendable ?? NaN);
  if (
    !Number.isFinite(minSendableMsat) ||
    !Number.isFinite(maxSendableMsat) ||
    minSendableMsat <= 0 ||
    maxSendableMsat <= 0 ||
    maxSendableMsat < minSendableMsat
  ) {
    throw new Error("Invalid LNURL min/max");
  }

  const minSendableSat = Math.max(1, Math.ceil(minSendableMsat / 1000));
  const maxSendableSat = Math.max(
    minSendableSat,
    Math.floor(maxSendableMsat / 1000),
  );

  const metadataRaw = asNonEmptyString(payReq.metadata);
  const parsedMetadata = parseLnurlPayMetadata(metadataRaw);
  if (!parsedMetadata) {
    throw new Error("LNURL metadata missing text/plain entry");
  }

  const commentAllowedRaw = Number(payReq.commentAllowed ?? 0);
  const commentAllowed =
    Number.isFinite(commentAllowedRaw) && commentAllowedRaw > 0
      ? Math.floor(commentAllowedRaw)
      : 0;

  return {
    callback,
    commentAllowed,
    description: parsedMetadata.description,
    lightningAddress: parsedMetadata.lightningAddress,
    maxSendableMsat,
    maxSendableSat,
    metadataRaw,
    minSendableMsat,
    minSendableSat,
    target: getLnurlPayDisplayText(requestUrl),
  };
};

export const fetchLnurlInvoiceForTarget = async (
  paymentTarget: string,
  amountSat: number,
  comment?: string,
  fallback?: LnurlFallback,
): Promise<LnurlPayInvoiceResult> => {
  if (!Number.isFinite(amountSat) || amountSat <= 0) {
    throw new Error("Invalid amount");
  }

  const payRequest = await fetchLnurlPayPreview(paymentTarget, fallback);

  let amountMsat = Math.round(amountSat * 1000);
  // Fiat-denominated fixed-amount LNURLs re-quote min/max msat from the
  // exchange rate on every fetch, so the value confirmed from the preview
  // drifts by the time the invoice is requested (and sat rounding alone can
  // put it outside a sub-sat-precise fixed range). Follow the fresh quote
  // when it stays close to what the user confirmed.
  const isFixedAmount =
    payRequest.minSendableMsat === payRequest.maxSendableMsat;
  if (isFixedAmount) {
    const freshFixedMsat = payRequest.minSendableMsat;
    const drift = Math.abs(freshFixedMsat - amountMsat) / amountMsat;
    if (drift <= FIXED_AMOUNT_REQUOTE_TOLERANCE) {
      amountMsat = freshFixedMsat;
    }
  }
  if (
    amountMsat < payRequest.minSendableMsat ||
    amountMsat > payRequest.maxSendableMsat
  ) {
    throw new Error("Amount out of LNURL range");
  }

  const callbackUrl = new URL(payRequest.callback);
  callbackUrl.searchParams.set("amount", String(amountMsat));

  const rawComment = String(comment ?? "").trim();

  // Some LNURL-pay providers omit/misreport commentAllowed. We try to include
  // a short comment (e.g., user display name) and fall back silently if it
  // causes invoice fetch to fail.
  const canUseComment = rawComment.length > 0;
  const providerAdvertisesComment = payRequest.commentAllowed > 0;
  const maybeWithCommentUrl = (() => {
    if (!canUseComment) return null;
    const u = new URL(callbackUrl.toString());
    const maxLen = providerAdvertisesComment ? payRequest.commentAllowed : 140;
    if (maxLen <= 0) return null;
    u.searchParams.set("comment", rawComment.slice(0, maxLen));
    return u.toString();
  })();

  const invoiceJson = await (async () => {
    if (maybeWithCommentUrl && !providerAdvertisesComment) {
      try {
        const withCommentJson = await fetchLnurlJson(
          maybeWithCommentUrl,
          fallback,
        );
        if (!isLnurlInvoiceResponse(withCommentJson)) {
          throw new Error("Invalid LNURL invoice response");
        }
        return withCommentJson;
      } catch {
        // Retry without comment.
      }
    }
    const fallbackJson = await fetchLnurlJson(callbackUrl.toString(), fallback);
    if (!isLnurlInvoiceResponse(fallbackJson)) {
      throw new Error("Invalid LNURL invoice response");
    }
    return fallbackJson;
  })();
  if (String(invoiceJson.status ?? "").toUpperCase() === "ERROR") {
    throw new Error(
      asNonEmptyString(invoiceJson.reason) ?? "LNURL invoice error",
    );
  }

  const pr =
    asNonEmptyString(invoiceJson.pr) ??
    asNonEmptyString(invoiceJson.paymentRequest);
  if (!pr) throw new Error("Invoice missing");

  // LUD-06 step 7: verify the invoice's `h` tag is sha256(utf8(metadata)) and
  // its amount equals the user-specified millisatoshis.
  const metadataRaw = payRequest.metadataRaw;
  if (metadataRaw) {
    const invoiceHashHex = getLightningInvoiceDescriptionHashHex(pr);
    if (invoiceHashHex) {
      const expectedHashHex = sha256HexFromString(metadataRaw);
      if (invoiceHashHex !== expectedHashHex) {
        throw new Error("LNURL invoice metadata hash mismatch");
      }
    }
  }
  const invoiceMsat = parseBolt11AmountMsat(pr);
  if (invoiceMsat !== null && invoiceMsat !== amountMsat) {
    throw new Error(
      `LNURL invoice amount mismatch (expected ${amountMsat} msat, got ${invoiceMsat})`,
    );
  }

  return {
    lightningAddress: payRequest.lightningAddress,
    pr,
    successAction: parseLnurlPaySuccessAction(invoiceJson.successAction),
  };
};

const resolveLnurlWithdrawRequestUrl = (value: string): string => {
  const httpUrl = resolveAnyLnurlTargetUrlOrNull(value);
  if (httpUrl) return httpUrl;

  throw new Error("Invalid LNURL withdraw target");
};

export const isLnurlWithdrawTarget = (value: string): boolean => {
  return resolveAnyLnurlTargetUrlOrNull(value) !== null;
};

export const fetchLnurlWithdrawPreview = async (
  withdrawTarget: string,
  fallback?: LnurlFallback,
): Promise<LnurlWithdrawPreview> => {
  const requestUrl = resolveLnurlWithdrawRequestUrl(withdrawTarget);
  const withdrawJson = await fetchLnurlJson(requestUrl, fallback);
  if (!isLnurlWithdrawRequest(withdrawJson)) {
    throw new Error("Invalid LNURL withdraw response");
  }

  // An LNURL error response carries no tag, so report the server's reason
  // before the tag check turns it into a misleading tag-mismatch error.
  if (String(withdrawJson.status ?? "").toUpperCase() === "ERROR") {
    throw new Error(asNonEmptyString(withdrawJson.reason) ?? "LNURL error");
  }

  const tag = String(withdrawJson.tag ?? "").trim();
  const looksLikeWithdrawRequest =
    asNonEmptyString(withdrawJson.callback) !== null &&
    asNonEmptyString(withdrawJson.k1) !== null &&
    Number.isFinite(Number(withdrawJson.minWithdrawable ?? NaN)) &&
    Number.isFinite(Number(withdrawJson.maxWithdrawable ?? NaN));

  if (!looksLikeWithdrawRequest && !isKnownLnurlTag(tag, "withdrawRequest")) {
    throw new LnurlTagMismatchError(tag);
  }

  const callback = asNonEmptyString(withdrawJson.callback);
  if (!callback) throw new Error("LNURL withdraw callback missing");

  const k1 = asNonEmptyString(withdrawJson.k1);
  if (!k1) throw new Error("LNURL withdraw k1 missing");

  const minWithdrawable = Number(withdrawJson.minWithdrawable ?? NaN);
  const maxWithdrawable = Number(withdrawJson.maxWithdrawable ?? NaN);
  if (!Number.isFinite(minWithdrawable) || !Number.isFinite(maxWithdrawable)) {
    throw new Error("LNURL withdraw min/max missing");
  }

  const minAmountSat = Math.floor(minWithdrawable / 1000);
  const maxAmountSat = Math.floor(maxWithdrawable / 1000);
  if (minAmountSat <= 0 || maxAmountSat <= 0 || maxAmountSat < minAmountSat) {
    throw new Error("Invalid LNURL withdraw amount");
  }

  return {
    amountSat: maxAmountSat,
    callback,
    description: asNonEmptyString(withdrawJson.defaultDescription) ?? null,
    k1,
    maxAmountSat,
    minAmountSat,
    target: getLnurlPayDisplayText(requestUrl),
  };
};

export const redeemLnurlWithdraw = async (
  args: {
    callback: string;
    invoice: string;
    k1: string;
  },
  fallback?: LnurlFallback,
): Promise<void> => {
  const callbackUrl = new URL(args.callback);
  callbackUrl.searchParams.set("k1", args.k1);
  callbackUrl.searchParams.set("pr", args.invoice);

  const responseJson = await fetchLnurlJson(callbackUrl.toString(), fallback);
  if (!isLnurlWithdrawCallbackResponse(responseJson)) {
    throw new Error("Invalid LNURL withdraw callback response");
  }

  if (String(responseJson.status ?? "").toUpperCase() === "ERROR") {
    throw new Error(
      asNonEmptyString(responseJson.reason) ?? "LNURL withdraw failed",
    );
  }
};
