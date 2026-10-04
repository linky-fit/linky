import { Effect } from "effect";
import { KeryxFetchFailed } from "../errors";
import type { Fetch } from "../domain";
import { allowedRedirectTargets } from "./urls";

export const MAX_DOCUMENT_BYTES = 1024 * 1024;

const readLimited = async (
  response: Response,
  maxBytes: number,
): Promise<Uint8Array | null> => {
  const declared = Number(response.headers.get("content-length"));
  if (declared > maxBytes) {
    await response.body?.cancel();
    return null;
  }
  if (response.body === null) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes.length > maxBytes ? null : bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
};

type FetchOutcome =
  | { readonly _tag: "Body"; readonly bytes: Uint8Array }
  | {
      readonly _tag: "Failed";
      readonly status?: number;
      readonly reason: string;
    };

const attempt = async (
  fetch: Fetch,
  url: URL,
  maxBytes: number,
): Promise<FetchOutcome> => {
  const response = await fetch(url.href, {
    credentials: "omit",
    redirect: "follow",
    referrerPolicy: "no-referrer",
  });
  if (response.url !== "" && !allowedRedirectTargets(url).has(response.url)) {
    await response.body?.cancel();
    return { _tag: "Failed", reason: `redirected to ${response.url}` };
  }
  if (!response.ok) {
    await response.body?.cancel();
    return {
      _tag: "Failed",
      status: response.status,
      reason: `HTTP ${response.status}`,
    };
  }
  const bytes = await readLimited(response, maxBytes);
  return bytes === null
    ? { _tag: "Failed", reason: `larger than ${maxBytes} bytes` }
    : { _tag: "Body", bytes };
};

/**
 * GET with the protocol's transport rules: no credentials or referrer, a final
 * URL that is the requested one or its canonical form, and the download
 * aborted beyond `maxBytes`. Browsers hide `redirect: "manual"` targets, so
 * redirects are followed and only where they end is checked.
 */
export const fetchBytes = (
  fetch: Fetch,
  url: URL,
  maxBytes: number,
): Effect.Effect<Uint8Array, KeryxFetchFailed> =>
  Effect.tryPromise({
    try: () => attempt(fetch, url, maxBytes),
    catch: (error) =>
      new KeryxFetchFailed({ url: url.href, reason: String(error) }),
  }).pipe(
    Effect.flatMap((outcome) =>
      outcome._tag === "Body"
        ? Effect.succeed(outcome.bytes)
        : Effect.fail(
            new KeryxFetchFailed({
              url: url.href,
              reason: outcome.reason,
              ...(outcome.status === undefined
                ? {}
                : { status: outcome.status }),
            }),
          ),
    ),
  );

export const isMissing = (error: KeryxFetchFailed): boolean =>
  error.status === 404 || error.status === 410;

const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** Parsed JSON of UTF-8 bytes, or null when either step fails. */
export const parseJsonBytes = (bytes: Uint8Array): unknown => {
  try {
    return JSON.parse(utf8.decode(bytes));
  } catch {
    return null;
  }
};

export const decodeUtf8 = (bytes: Uint8Array): string | null => {
  try {
    return utf8.decode(bytes);
  } catch {
    return null;
  }
};
