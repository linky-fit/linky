import { Result, Schema } from "effect";
import type { Event as NostrToolsEvent } from "nostr-tools";
import type { EventId, RelayUrl } from "../domain/primitives";
import { Pubkey, UnixSeconds } from "../domain/primitives";
import type { SignedPlainEvent } from "../internal/nostrEvent";
import { decodeVerifiedPlainEvent } from "../internal/plainEvent";
import { decodeProfileEvent } from "./codec";
import { ProfileMetadata } from "./domain";

export class ProfileSearchHit extends Schema.Class<ProfileSearchHit>(
  "ProfileSearchHit",
)({
  pubkey: Pubkey,
  metadata: ProfileMetadata,
  updatedAt: UnixSeconds,
}) {}

/** Case- and accent-insensitive: "Jína" and "jina" fold to the same text. */
const foldSearchText = (value: string): string =>
  value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLocaleLowerCase()
    .trim();

const searchTokens = (query: string): Array<string> =>
  foldSearchText(query).split(/\s+/).filter(Boolean);

const foldedFields = (
  fields: ReadonlyArray<string | undefined>,
): Array<string> =>
  fields
    .filter((field): field is string => field !== undefined)
    .map(foldSearchText);

const PREFIX_WILDCARD_MIN_TOKEN_LENGTH = 3;

/**
 * Companion query with a trailing `*`, for relays whose full-text index
 * matches whole words only ("chaincamp" misses "chaincampcz" there). Relays
 * that treat `*` literally answer it with nothing, which costs one request.
 * Undefined when the query already uses search syntax or ends in a short word.
 */
export const prefixSearchQuery = (query: string): string | undefined => {
  const trimmed = query.trim();
  if (/[*"]/.test(trimmed)) return undefined;
  const lastToken = trimmed.split(/\s+/).at(-1) ?? "";
  if (lastToken.length < PREFIX_WILDCARD_MIN_TOKEN_LENGTH) return undefined;
  return `${trimmed}*`;
};

/**
 * Every query word must appear somewhere in the profile text. NIP-50 relays
 * match per word and also in `about`, so anything stricter throws away hits
 * the relay legitimately returned; the check still guards against relays that
 * ignore `search` and answer with arbitrary profiles.
 */
export const profileMatchesSearchQuery = (
  metadata: ProfileMetadata,
  query: string,
): boolean => {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return false;
  const haystack = foldedFields([
    metadata.name,
    metadata.displayName,
    metadata.nip05,
    metadata.lud16,
    metadata.about,
  ]).join("\n");
  return tokens.every((token) => haystack.includes(token));
};

const PREFERRED_DOMAIN_BONUS = 1000;
const NAME_TIER_WEIGHT = 100;
const NIP05_BONUS = 20;
const PICTURE_BONUS = 10;
const EXTRA_RELAY_BONUS = 15;
const MAX_POSITION_PENALTY = 50;

/**
 * 0 = a name equals the query, 1 = a name starts with it, 2 = every query
 * word occurs in a name, 3 = the match is only in nip05/lud16/about.
 */
const nameTier = (metadata: ProfileMetadata, query: string): number => {
  const needle = foldSearchText(query);
  const names = foldedFields([metadata.name, metadata.displayName]);
  if (names.includes(needle)) return 0;
  if (names.some((name) => name.startsWith(needle))) return 1;
  const tokens = searchTokens(query);
  if (tokens.every((token) => names.some((name) => name.includes(token)))) {
    return 2;
  }
  return 3;
};

const hasPreferredDomain = (
  metadata: ProfileMetadata,
  domains: ReadonlyArray<string>,
): boolean =>
  domains.some((domain) => {
    const suffix = `@${domain.toLowerCase()}`;
    return [metadata.nip05, metadata.lud16].some(
      (field) => field !== undefined && field.toLowerCase().endsWith(suffix),
    );
  });

interface CollectedProfile {
  newest: SignedPlainEvent;
  metadata: ProfileMetadata | null;
  /** Lowest index among the distinct authors a relay returned, in its order. */
  bestPosition: number;
  relays: Set<RelayUrl>;
}

export interface RankedProfileSearchHit {
  readonly hit: ProfileSearchHit;
  readonly eventId: EventId;
}

export interface ProfileSearchRankingOptions {
  /**
   * Profiles whose nip05 or lud16 ends in `@<domain>` rank above all others;
   * the name tier still orders them among themselves.
   */
  readonly preferredDomains?: ReadonlyArray<string>;
}

/**
 * Lower is better. A preferred domain comes first, then the name tier; within
 * a tier a relay's own ordering is the relevance signal, nudged by
 * verifiable-looking profiles (nip05, picture) and agreement between relays.
 */
const relevanceScore = (
  collected: CollectedProfile,
  metadata: ProfileMetadata,
  query: string,
  options: ProfileSearchRankingOptions,
): number =>
  (hasPreferredDomain(metadata, options.preferredDomains ?? [])
    ? -PREFERRED_DOMAIN_BONUS
    : 0) +
  nameTier(metadata, query) * NAME_TIER_WEIGHT +
  Math.min(collected.bestPosition, MAX_POSITION_PENALTY) -
  (metadata.nip05 ? NIP05_BONUS : 0) -
  (metadata.picture ? PICTURE_BONUS : 0) -
  (collected.relays.size - 1) * EXTRA_RELAY_BONUS;

const decodeMetadata = (event: SignedPlainEvent): ProfileMetadata | null => {
  const decoded = decodeProfileEvent(event);
  return Result.isFailure(decoded) ? null : decoded.success.metadata;
};

/**
 * Accumulates one relay answer at a time and ranks the current profile of
 * every author seen so far, so callers can surface hits before the slowest
 * relay has answered.
 */
export const createProfileSearchCollector = (
  query: string,
  options: ProfileSearchRankingOptions = {},
) => {
  const byAuthor = new Map<Pubkey, CollectedProfile>();

  const add = (
    relay: RelayUrl,
    rawEvents: ReadonlyArray<NostrToolsEvent>,
  ): void => {
    const positionByAuthor = new Map<Pubkey, number>();
    for (const raw of rawEvents) {
      const decoded = decodeVerifiedPlainEvent(raw);
      if (Result.isFailure(decoded)) continue;
      const event = decoded.success;
      const position =
        positionByAuthor.get(event.pubkey) ?? positionByAuthor.size;
      positionByAuthor.set(event.pubkey, position);

      const existing = byAuthor.get(event.pubkey);
      if (existing === undefined) {
        byAuthor.set(event.pubkey, {
          newest: event,
          metadata: decodeMetadata(event),
          bestPosition: position,
          relays: new Set([relay]),
        });
        continue;
      }
      existing.relays.add(relay);
      existing.bestPosition = Math.min(existing.bestPosition, position);
      if (event.created_at > existing.newest.created_at) {
        existing.newest = event;
        existing.metadata = decodeMetadata(event);
      }
    }
  };

  const top = (limit: number): Array<RankedProfileSearchHit> => {
    const scored: Array<{ ranked: RankedProfileSearchHit; score: number }> = [];
    for (const [pubkey, collected] of byAuthor) {
      const metadata = collected.metadata;
      if (metadata === null) continue;
      if (!profileMatchesSearchQuery(metadata, query)) continue;
      scored.push({
        score: relevanceScore(collected, metadata, query, options),
        ranked: {
          eventId: collected.newest.id,
          hit: new ProfileSearchHit({
            pubkey,
            metadata,
            updatedAt: collected.newest.created_at,
          }),
        },
      });
    }
    scored.sort(
      (a, b) =>
        a.score - b.score || b.ranked.hit.updatedAt - a.ranked.hit.updatedAt,
    );
    return scored.slice(0, limit).map(({ ranked }) => ranked);
  };

  return { add, top } as const;
};
