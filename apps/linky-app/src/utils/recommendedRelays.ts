import { Schema } from "effect";
import bundledRecommendedRelays from "@linky-fit/site/recommended-relays.json";
import { safeLocalStorageGetJson, safeLocalStorageSetJson } from "./storage";

const STORAGE_KEY = "linky.recommendedRelays.v1";

/** The body of linky.fit/recommended-relays. */
export const RecommendedRelayLists = Schema.Struct({
  nostr: Schema.Array(Schema.String),
  evolu: Schema.Array(Schema.String),
});

const StoredRecommendedRelays = Schema.Struct({
  ...RecommendedRelayLists.fields,
  // Nostr relays the endpoint stopped recommending; published lists that
  // still carry them came from the recommendation, not from the user.
  retiredNostr: Schema.Array(Schema.String),
});

export type RecommendedRelays = typeof StoredRecommendedRelays.Type;

const bundled: RecommendedRelays = {
  ...Schema.decodeUnknownSync(RecommendedRelayLists)(bundledRecommendedRelays),
  retiredNostr: [],
};

export const loadRecommendedRelays = (): RecommendedRelays =>
  safeLocalStorageGetJson(STORAGE_KEY, StoredRecommendedRelays, bundled);

export const saveRecommendedRelays = (relays: RecommendedRelays): void => {
  safeLocalStorageSetJson(STORAGE_KEY, relays);
};

export const withFetchedRecommendedRelays = (
  previous: RecommendedRelays,
  fetched: typeof RecommendedRelayLists.Type,
): RecommendedRelays => {
  const stillRecommended = new Set(fetched.nostr);
  return {
    ...fetched,
    retiredNostr: Array.from(
      new Set([...previous.retiredNostr, ...previous.nostr]),
    ).filter((url) => !stillRecommended.has(url)),
  };
};

/**
 * The recommended relays first, then the listed ones that are neither
 * recommended nor retired, deduplicated by `identity`.
 */
export const withRecommended = (
  listed: readonly string[],
  recommended: readonly string[],
  retired: readonly string[],
  identity: (url: string) => string,
): string[] => {
  const retiredIds = new Set(retired.map(identity));
  const seen = new Set<string>();
  return [
    ...recommended,
    ...listed.filter((url) => !retiredIds.has(identity(url))),
  ].filter((url) => {
    const id = identity(url);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
};
