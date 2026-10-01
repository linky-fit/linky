import { Effect, Option, Result, Schema } from "effect";
import type {
  Announcement,
  Fetch,
  ItemProblem,
  PrivateFeedInfo,
  PrivateFeedState,
  PrivateFeedSync,
} from "../domain";
import { publicKeysById } from "./crypto";
import {
  fetchBytes,
  isMissing,
  MAX_DOCUMENT_BYTES,
  parseJsonBytes,
} from "./fetchBytes";
import {
  announcementOf,
  asObject,
  checkDocumentSignatures,
  decodeWith,
} from "./items";
import { isExpired } from "./metadata";
import type { Authority } from "./metadata";
import { parseKeryxUrl } from "./urls";
import {
  ItemFields,
  PrivateFeedDocument,
  PrivateFeedPattern,
  TargetsCustom,
} from "./wire";

export interface AuthorizedPattern {
  readonly info: PrivateFeedInfo;
  readonly authority: Authority;
  readonly origin: string;
  readonly segments: ReadonlyArray<string>;
}

const decodePattern = Schema.decodeUnknownOption(PrivateFeedPattern);

const authorizedPattern = (raw: unknown): Option.Option<AuthorizedPattern> =>
  Option.flatMap(decodePattern(raw), (entry) => {
    const url = parseKeryxUrl(entry.pattern);
    const segments = url?.pathname.split("/") ?? [];
    // Key publication rule: every keyid must have its key object in the entry.
    const published = entry.keyids.every((keyid) =>
      Object.hasOwn(entry.keys, keyid),
    );
    const wildcardsWhole = segments.every(
      (segment) => segment === "*" || !segment.includes("*"),
    );
    if (
      url === null ||
      url.host.includes("*") ||
      url.search !== "" ||
      !published ||
      !wildcardsWhole
    ) {
      return Option.none();
    }
    return Option.some({
      info: {
        channel: entry.channel,
        ...(entry.display_name === undefined
          ? {}
          : { displayName: entry.display_name }),
        ...(entry.purpose === undefined ? {} : { purpose: entry.purpose }),
      },
      authority: {
        keys: publicKeysById(entry.keys),
        keyids: entry.keyids,
        threshold: entry.threshold,
      },
      origin: url.origin,
      segments,
    });
  });

/** The valid `custom.private_feed_patterns` entries; a malformed entry authorizes nothing. */
export const authorizedPatterns = (
  custom: typeof TargetsCustom.Type,
): ReadonlyArray<AuthorizedPattern> =>
  (custom.private_feed_patterns ?? []).flatMap((entry) =>
    Option.toArray(authorizedPattern(entry)),
  );

/** Origin-exact; `*` is one whole, non-empty path segment (the capability token). */
export const matchPattern = (
  patterns: ReadonlyArray<AuthorizedPattern>,
  feedUrl: string,
): AuthorizedPattern | undefined => {
  const url = parseKeryxUrl(feedUrl);
  if (url === null || url.search !== "") return undefined;
  const segments = url.pathname.split("/");
  return patterns.find(
    (pattern) =>
      pattern.origin === url.origin &&
      pattern.segments.length === segments.length &&
      pattern.segments.every((expected, index) => {
        const actual = segments[index] ?? "";
        return expected === "*" ? actual !== "" : expected === actual;
      }),
  );
};

export interface PrivateFeedResult {
  readonly sync: PrivateFeedSync;
  readonly announcements: ReadonlyArray<Announcement>;
}

type Verified = {
  readonly document: typeof PrivateFeedDocument.Type;
  readonly announcements: ReadonlyArray<Announcement>;
  readonly problems: ReadonlyArray<ItemProblem>;
};

const verifyDocument = (
  bytes: Uint8Array,
  url: string,
  pattern: AuthorizedPattern,
): Result.Result<Verified, string> =>
  Result.gen(function* () {
    const raw = yield* asObject(parseJsonBytes(bytes));
    if (raw["v"] !== 1)
      return yield* Result.fail(`unknown v ${String(raw["v"])}`);
    const document = yield* decodeWith(PrivateFeedDocument, raw);
    yield* checkDocumentSignatures(raw, document.sig, pattern.authority);
    if (document.channel !== pattern.info.channel) {
      return yield* Result.fail("channel differs from the authorizing pattern");
    }
    const bound = parseKeryxUrl(document.url);
    const fetched = new URL(url);
    if (
      bound === null ||
      bound.origin !== fetched.origin ||
      bound.pathname !== fetched.pathname
    ) {
      return yield* Result.fail("signed url differs from the fetched URL");
    }
    const items = document.items.map((item, index) =>
      decodeWith(ItemFields, item).pipe(
        Result.flatMap((fields) =>
          announcementOf(fields, {
            channel: document.channel,
            privateFeedUrl: url,
          }),
        ),
        Result.mapError(
          (reason): ItemProblem => ({
            path: `${url}#${index}`,
            reason,
            keptCachedCopy: false,
          }),
        ),
      ),
    );
    return {
      document,
      announcements: items.flatMap((item) =>
        Result.getSuccess(item).pipe(Option.toArray),
      ),
      problems: items.flatMap((item) =>
        Result.getFailure(item).pipe(Option.toArray),
      ),
    };
  });

/** Feeds §3 enforcement sequence for one subscribed private feed. */
export const syncPrivateFeed = (options: {
  readonly fetch: Fetch;
  readonly now: Date;
  readonly state: PrivateFeedState;
  readonly patterns: ReadonlyArray<AuthorizedPattern>;
  readonly known: ReadonlyArray<Announcement>;
}): Effect.Effect<PrivateFeedResult> =>
  Effect.gen(function* () {
    const { state } = options;
    const cached = options.known.filter(
      (announcement) => announcement.privateFeedUrl === state.url,
    );
    const keep = (
      sync: Omit<PrivateFeedSync, "state" | "problems"> & {
        readonly state?: PrivateFeedState;
      },
    ): PrivateFeedResult => ({
      sync: { state, problems: [], ...sync },
      announcements: cached,
    });
    if (state.closed) return keep({ status: "closed" });
    const pattern = matchPattern(options.patterns, state.url);
    if (pattern === undefined) {
      return keep({
        status: "unauthorized",
        state: { ...state, closed: true },
      });
    }
    const info = pattern.info;
    const fetched = yield* Effect.result(
      fetchBytes(options.fetch, new URL(state.url), MAX_DOCUMENT_BYTES),
    );
    if (Result.isFailure(fetched)) {
      return isMissing(fetched.failure)
        ? keep({ status: "closed", info, state: { ...state, closed: true } })
        : keep({ status: "unavailable", info, reason: fetched.failure.reason });
    }
    const verified = verifyDocument(fetched.success, state.url, pattern);
    if (Result.isFailure(verified)) {
      return keep({ status: "unavailable", info, reason: verified.failure });
    }
    const { document, announcements, problems } = verified.success;
    if (state.version !== undefined && document.version < state.version) {
      return keep({
        status: "unavailable",
        info,
        reason: `version ${document.version} is older than the trusted ${state.version}`,
      });
    }
    const expires = document.expires;
    if (!document.expired && isExpired(expires, options.now)) {
      return keep({ status: "stale", info, expires });
    }
    return {
      sync: {
        state: {
          url: state.url,
          version: document.version,
          closed: document.expired,
        },
        status: document.expired ? "closed" : "active",
        info,
        expires,
        problems,
      },
      announcements,
    };
  });
