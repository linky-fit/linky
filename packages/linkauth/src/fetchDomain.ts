import { normalizeAudience } from "./audience.js";
import { DOMAIN_DOCUMENT_PATH, parseDomainDocument } from "./domain.js";
import type { DomainDocumentProblem, LinkauthDomain } from "./domain.js";

const MAX_BYTES = 4096;
const DEFAULT_TIMEOUT_MS = 5000;

/** The part of `fetch` the loader uses; pass your own to proxy or to test. */
export type LinkauthFetch = (
  url: string,
  init: RequestInit,
) => Promise<Response>;

export interface FetchDomainOptions {
  /** `globalThis.fetch` by default. */
  fetch?: LinkauthFetch;
  /** Covers connecting and reading the body; 5 seconds by default. */
  timeoutMs?: number;
}

/** Why a domain could not be verified. Stable: safe to log and to switch on. */
export type DomainFailure =
  /** The origin is not an acceptable site. */
  | "invalid-origin"
  /** No answer, a redirect, a non-2xx status or a network error. */
  | "unreachable"
  /** The body is over 4096 bytes. */
  | "too-large"
  | "invalid-json"
  | `invalid-document:${DomainDocumentProblem}`;

export type FetchDomainResult =
  | { ok: true; domain: LinkauthDomain }
  | { ok: false; reason: DomainFailure };

/** The body, or `null` when it is over the limit; stops reading at the limit. */
const readLimited = async (response: Response): Promise<Uint8Array | null> => {
  if (Number(response.headers.get("content-length")) > MAX_BYTES) return null;
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (reader !== undefined) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      void reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
};

/**
 * Loads and validates `<origin>/.well-known/linkauth.json`: no credentials,
 * no referrer, no redirects, 5 seconds, at most 4096 bytes. Never throws;
 * the site must serve the file with `Access-Control-Allow-Origin: *` for a
 * browser on another origin to read it.
 */
export const fetchDomainDocument = async (
  origin: string,
  options: FetchDomainOptions = {},
): Promise<FetchDomainResult> => {
  const normalized = normalizeAudience(origin);
  if (normalized === null) return { ok: false, reason: "invalid-origin" };
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  let body: Uint8Array | null;
  try {
    const response = await doFetch(`${normalized}${DOMAIN_DOCUMENT_PATH}`, {
      method: "GET",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    if (!response.ok) return { ok: false, reason: "unreachable" };
    body = await readLimited(response);
  } catch {
    return { ok: false, reason: "unreachable" };
  }
  if (body === null) return { ok: false, reason: "too-large" };
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    return { ok: false, reason: "invalid-json" };
  }
  const parsed = parseDomainDocument(json, normalized);
  return parsed.ok
    ? { ok: true, domain: parsed.domain }
    : { ok: false, reason: `invalid-document:${parsed.problem}` };
};
