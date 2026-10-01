import { Result, Schema } from "effect";
import type { JoinRequest } from "./domain";
import { KeryxJoinUrlInvalid, KeryxJoinVersionUnsupported } from "./errors";
import type { KeryxJoinError } from "./errors";
import { base64UrlToBytesOrNull } from "./internal/crypto";
import { parseJsonBytes } from "./internal/fetchBytes";
import { parseKeryxUrl } from "./internal/urls";
import { JoinPayload } from "./internal/wire";

const MAX_PAYLOAD_CHARS = 4096;
const PAYLOAD_LESS_PATHS = new Set(["/", "/join", "/join/"]);
const decodePayload = Schema.decodeUnknownResult(JoinPayload);

const invalid = (reason: string) =>
  Result.fail(new KeryxJoinUrlInvalid({ reason }));

/**
 * Parse a scanned join URL without touching the network. The origin comes back
 * as ASCII (punycode for IDNs) for the user to confirm; a payload of an
 * unknown `v` is `KeryxJoinVersionUnsupported`.
 */
export const parseJoinUrl = (
  text: string,
): Result.Result<JoinRequest, KeryxJoinError> => {
  const url = parseKeryxUrl(text.trim());
  if (url === null) return invalid("not an HTTPS URL");
  const encoded = url.searchParams.get("p");
  if (encoded === null) {
    return PAYLOAD_LESS_PATHS.has(url.pathname)
      ? Result.succeed({ origin: url.origin, channels: [], privateFeeds: [] })
      : invalid("a join URL without a payload must be /join or the origin");
  }
  if (encoded.length > MAX_PAYLOAD_CHARS) return invalid("payload too large");
  const bytes = base64UrlToBytesOrNull(encoded);
  if (bytes === null)
    return invalid("payload is not base64url without padding");
  const payload = parseJsonBytes(bytes);
  if (typeof payload !== "object" || payload === null || !("v" in payload)) {
    return invalid("payload is not a versioned JSON object");
  }
  if (payload.v !== 1) {
    return typeof payload.v === "number"
      ? Result.fail(new KeryxJoinVersionUnsupported({ version: payload.v }))
      : invalid("payload version is not a number");
  }
  const decoded = decodePayload(payload);
  if (Result.isFailure(decoded))
    return invalid("payload does not match version 1");
  const privateFeeds = [...new Set(decoded.success.private_feeds)];
  if (privateFeeds.some((feed) => parseKeryxUrl(feed) === null)) {
    return invalid("a private feed is not an HTTPS URL");
  }
  return Result.succeed({
    origin: url.origin,
    channels: [...new Set(decoded.success.channels)],
    privateFeeds,
  });
};
