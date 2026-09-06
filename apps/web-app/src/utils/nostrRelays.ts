import { DEFAULT_NOSTR_RELAYS } from "@linky/linkstr";
import { RelayUrl } from "@linky/linkstr";
import { Schema } from "effect";
import { safeLocalStorageGetJson, safeLocalStorageSetJson } from "./storage";

const isRelayUrl = Schema.is(RelayUrl);

const envRelays = Array.from(
  new Set(
    (import.meta.env.VITE_NOSTR_RELAYS ?? "")
      .split(",")
      .map((url) => url.trim())
      .filter(isRelayUrl),
  ),
);

export const NOSTR_RELAYS =
  envRelays.length > 0 ? envRelays : DEFAULT_NOSTR_RELAYS;

// NIP-50 relays for profile text search; the default read relays do not
// index kind-0 content, so contact search would find nothing without them.
const DEFAULT_NOSTR_SEARCH_RELAYS = [
  "wss://search.nos.today",
  "wss://nostr.wine",
];

const envSearchRelays = Array.from(
  new Set(
    (import.meta.env.VITE_NOSTR_SEARCH_RELAYS ?? "")
      .split(",")
      .map((url) => url.trim())
      .filter(isRelayUrl),
  ),
);

export const NOSTR_SEARCH_RELAYS: ReadonlyArray<RelayUrl> =
  envSearchRelays.length > 0
    ? envSearchRelays
    : DEFAULT_NOSTR_SEARCH_RELAYS.filter(isRelayUrl);

// Startup bootstrap cache of the user's published relay lists (kinds
// 10002/10050), so a cold launch connects to the last known set instead of
// the defaults and rarely needs a runtime rebuild. The signed nostr events
// stay authoritative; the timestamps let a fetch result that is older than
// the cache be recognized as a stale relay response.
const RELAY_CACHE_KEY_PREFIX = "linky.nostr_relays.v1";

const CachedRelayListsSchema = Schema.Struct({
  relayUrls: Schema.Array(Schema.String),
  relaysUpdatedAt: Schema.NullOr(Schema.Number),
  dmRelaysUpdatedAt: Schema.NullOr(Schema.Number),
});

type CachedRelayLists = typeof CachedRelayListsSchema.Type;

export const loadCachedRelayLists = (
  pubkey: string,
): CachedRelayLists | null => {
  const cached = safeLocalStorageGetJson(
    `${RELAY_CACHE_KEY_PREFIX}.${pubkey}`,
    Schema.NullOr(CachedRelayListsSchema),
    null,
  );
  if (cached === null) return null;
  const relayUrls = Array.from(new Set(cached.relayUrls.filter(isRelayUrl)));
  if (relayUrls.length === 0) return null;
  return { ...cached, relayUrls };
};

export const saveCachedRelayLists = (
  pubkey: string,
  lists: CachedRelayLists,
): void => {
  safeLocalStorageSetJson(`${RELAY_CACHE_KEY_PREFIX}.${pubkey}`, lists);
};
