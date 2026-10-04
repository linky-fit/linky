import { Effect } from "effect";
import type { Fetch } from "./domain";
import { KeryxMediaUnavailable } from "./errors";
import { sha256Hex } from "./internal/crypto";
import { fetchBytes } from "./internal/fetchBytes";
import { parseKeryxUrl } from "./internal/urls";

const DEFAULT_MAX_MEDIA_BYTES = 25 * 1024 * 1024;

/**
 * Download linked media pinned by a SHA-256 (a linked logo, an item `image`,
 * an attachment with `sha256`) and return the bytes only if they match. On
 * failure show a placeholder; the announcement itself stays valid.
 */
export const fetchVerifiedMedia = (options: {
  readonly url: string;
  readonly sha256: string;
  readonly fetch: Fetch;
  readonly maxBytes?: number;
}): Effect.Effect<Uint8Array, KeryxMediaUnavailable> => {
  const url = parseKeryxUrl(options.url);
  if (url === null) {
    return Effect.fail(
      new KeryxMediaUnavailable({
        url: options.url,
        reason: "not an HTTPS URL",
      }),
    );
  }
  return fetchBytes(
    options.fetch,
    url,
    options.maxBytes ?? DEFAULT_MAX_MEDIA_BYTES,
  ).pipe(
    Effect.mapError(
      (error) =>
        new KeryxMediaUnavailable({ url: options.url, reason: error.reason }),
    ),
    Effect.filterOrFail(
      (bytes) => sha256Hex(bytes) === options.sha256,
      () =>
        new KeryxMediaUnavailable({
          url: options.url,
          reason: "bytes differ from the pinned sha256",
        }),
    ),
  );
};
