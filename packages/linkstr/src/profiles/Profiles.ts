import { Effect, Either, Schema } from "effect";
import type { Duration } from "effect";
import type { Filter } from "nostr-tools";
import type { PlainEventReceipt } from "../domain/delivery";
import { RelayRejection } from "../domain/delivery";
import type { NoRelayAcceptedEvent } from "../domain/errors";
import { AllRelaysUnreachable, NoReadRelaysConfigured } from "../domain/errors";
import type { EventId, RelayUrl } from "../domain/primitives";
import { Pubkey, UnixSeconds } from "../domain/primitives";
import { Inspector } from "../inspector/Inspector";
import { chunkAuthors } from "../internal/authorChunks";
import { inspectPlainOperation } from "../internal/inspectPlainOperation";
import type { NostrTags, SignedPlainEvent } from "../internal/nostrEvent";
import { deliverPlainEvent } from "../internal/plainDelivery";
import { fetchPlainEvents } from "../internal/plainFetch";
import { nowSeconds } from "../internal/time";
import { LinkstrIdentity } from "../services/LinkstrIdentity";
import { NostrTransport } from "../services/NostrTransport";
import { RelayPolicy } from "../services/RelayPolicy";
import {
  decodeProfileEvent,
  decodeStatusEvent,
  encodeProfileContent,
  PROFILE_KIND,
  STATUS_D_GENERAL,
  STATUS_KIND,
} from "./codec";
import { ProfileMetadata } from "./domain";
import type { StatusDraft } from "./domain";
import { ProfileUpdated, StatusUpdated } from "./events";
import { createProfileSearchCollector, prefixSearchQuery } from "./search";
import type { ProfileSearchHit } from "./search";

export class ProfileFetchResult extends Schema.Class<ProfileFetchResult>(
  "ProfileFetchResult",
)({
  profile: Schema.NullOr(ProfileUpdated),
  status: Schema.NullOr(StatusUpdated),
}) {}

export class ProfileFetchEntry extends Schema.Class<ProfileFetchEntry>(
  "ProfileFetchEntry",
)({
  pubkey: Pubkey,
  profile: Schema.NullOr(ProfileUpdated),
  status: Schema.NullOr(StatusUpdated),
}) {}

const DISCOVERY_ACTIVITY_KINDS: ReadonlyArray<number> = [
  0, 1, 6, 7, 9735, 30315,
];
const DISCOVERY_ACTIVE_WINDOW_SECONDS = 45 * 24 * 60 * 60;
const DISCOVERY_AUTHOR_SCAN_LIMIT = 64;

export interface DiscoverActiveProfilesOptions {
  readonly activityKinds?: ReadonlyArray<number>;
  readonly activeWindowSeconds?: number;
  readonly authorScanLimit?: number;
}

export const PROFILE_SEARCH_DEFAULT_LIMIT = 6;
/** Per relay: several kind-0 versions per author collapse into one hit. */
export const PROFILE_SEARCH_OVERFETCH_FACTOR = 4;
export const PROFILE_SEARCH_DEADLINE: Duration.DurationInput = "2500 millis";

export interface SearchProfilesOptions {
  readonly limit?: number;
  /**
   * NIP-50 relays. Only these receive the `search` filter; the read relays
   * are used as a fallback when none are given, since most of them ignore
   * `search` and would only pad the merge with unrelated profiles.
   */
  readonly searchRelays?: ReadonlyArray<RelayUrl>;
  /** Relays still silent when this elapses are dropped from the result. */
  readonly deadline?: Duration.DurationInput;
  /** Profiles whose nip05/lud16 ends in `@<domain>` rank above all others. */
  readonly preferredDomains?: ReadonlyArray<string>;
  /** Ranked hits so far, each time another relay answers. */
  readonly onHits?: (hits: ReadonlyArray<ProfileSearchHit>) => void;
}

export class DiscoveredProfile extends Schema.Class<DiscoveredProfile>(
  "DiscoveredProfile",
)({
  pubkey: Pubkey,
  lastActiveAt: UnixSeconds,
  metadata: ProfileMetadata,
}) {}

/** Newest event of `kind` that decodes; `events` arrive newest-first. */
const pickNewest = <A>(
  events: ReadonlyArray<SignedPlainEvent>,
  kind: number,
  decode: (event: SignedPlainEvent) => Either.Either<A, unknown>,
): { fact: A; eventId: EventId } | null => {
  for (const event of events) {
    if (event.kind !== kind) continue;
    const decoded = decode(event);
    if (Either.isRight(decoded)) {
      return { fact: decoded.right, eventId: event.id };
    }
  }
  return null;
};

export class Profiles extends Effect.Service<Profiles>()("linkstr/Profiles", {
  effect: Effect.gen(function* () {
    const context = {
      identity: yield* LinkstrIdentity,
      transport: yield* NostrTransport,
      relayPolicy: yield* RelayPolicy,
    };
    const inspector = yield* Inspector.orNoop;

    const publishProfile = (
      metadata: ProfileMetadata,
    ): Effect.Effect<PlainEventReceipt, NoRelayAcceptedEvent> =>
      deliverPlainEvent(context, {
        kind: PROFILE_KIND,
        tags: [],
        content: encodeProfileContent(metadata),
      }).pipe(
        Effect.map((receipt) => ({
          result: receipt,
          eventIds: [receipt.eventId],
        })),
        inspectPlainOperation(inspector, "profiles.publishProfile", metadata),
      );

    const statusTags = (draft: StatusDraft): NostrTags => {
      const tags: NostrTags = [["d", STATUS_D_GENERAL]];
      if (draft.expiresAt !== undefined) {
        tags.push(["expiration", String(draft.expiresAt)]);
      }
      return tags;
    };

    const publishStatus = (
      draft: StatusDraft,
    ): Effect.Effect<PlainEventReceipt, NoRelayAcceptedEvent> =>
      deliverPlainEvent(context, {
        kind: STATUS_KIND,
        tags: statusTags(draft),
        content: draft.content,
      }).pipe(
        Effect.map((receipt) => ({
          result: receipt,
          eventIds: [receipt.eventId],
        })),
        inspectPlainOperation(inspector, "profiles.publishStatus", draft),
      );

    const fetchProfileEntries = (
      pubkeys: ReadonlyArray<Pubkey>,
    ): Effect.Effect<
      { result: Array<ProfileFetchEntry>; eventIds: Array<EventId> },
      AllRelaysUnreachable | NoReadRelaysConfigured
    > =>
      Effect.gen(function* () {
        const relays = context.relayPolicy.readRelays;
        if (relays.length === 0) return yield* new NoReadRelaysConfigured();
        const authors = [...new Set(pubkeys)];
        if (authors.length === 0) return { result: [], eventIds: [] };

        const eventsPerChunk = yield* Effect.forEach(
          chunkAuthors(authors),
          (chunk) =>
            fetchPlainEvents(context.transport, relays, {
              kinds: [PROFILE_KIND, STATUS_KIND],
              authors: chunk,
            }),
          // Bounded: each chunk already fans out to every read relay.
          { concurrency: 4 },
        );
        const now: UnixSeconds = yield* nowSeconds;

        // Chunks hold disjoint authors, so concatenation keeps each author's
        // events newest-first (fetchPlainEvents sorts within a chunk).
        const eventsByAuthor = new Map<Pubkey, Array<SignedPlainEvent>>();
        for (const event of eventsPerChunk.flat()) {
          const ofAuthor = eventsByAuthor.get(event.pubkey);
          if (ofAuthor === undefined) eventsByAuthor.set(event.pubkey, [event]);
          else ofAuthor.push(event);
        }

        const result: Array<ProfileFetchEntry> = [];
        const eventIds: Array<EventId> = [];
        for (const pubkey of authors) {
          const ofAuthor = eventsByAuthor.get(pubkey) ?? [];
          const profile = pickNewest(
            ofAuthor,
            PROFILE_KIND,
            decodeProfileEvent,
          );
          const status = pickNewest(ofAuthor, STATUS_KIND, (event) =>
            decodeStatusEvent(event, now),
          );
          result.push(
            new ProfileFetchEntry({
              pubkey,
              profile: profile?.fact ?? null,
              status: status?.fact ?? null,
            }),
          );
          for (const picked of [profile, status]) {
            if (picked !== null) eventIds.push(picked.eventId);
          }
        }
        return { result, eventIds };
      });

    const fetchProfile = (
      pubkey: Pubkey,
    ): Effect.Effect<
      ProfileFetchResult,
      AllRelaysUnreachable | NoReadRelaysConfigured
    > =>
      fetchProfileEntries([pubkey]).pipe(
        Effect.map(({ result, eventIds }) => ({
          result: new ProfileFetchResult({
            profile: result[0]?.profile ?? null,
            status: result[0]?.status ?? null,
          }),
          eventIds,
        })),
        inspectPlainOperation(inspector, "profiles.fetchProfile", pubkey),
      );

    const fetchProfiles = (
      pubkeys: ReadonlyArray<Pubkey>,
    ): Effect.Effect<
      ReadonlyArray<ProfileFetchEntry>,
      AllRelaysUnreachable | NoReadRelaysConfigured
    > =>
      fetchProfileEntries(pubkeys).pipe(
        inspectPlainOperation(inspector, "profiles.fetchProfiles", pubkeys),
      );

    const discoverActiveProfiles = (
      options: DiscoverActiveProfilesOptions = {},
    ): Effect.Effect<
      ReadonlyArray<DiscoveredProfile>,
      AllRelaysUnreachable | NoReadRelaysConfigured
    > =>
      Effect.gen(function* () {
        const relays = context.relayPolicy.readRelays;
        if (relays.length === 0) return yield* new NoReadRelaysConfigured();
        const now: UnixSeconds = yield* nowSeconds;
        const activityEvents = yield* fetchPlainEvents(
          context.transport,
          relays,
          {
            kinds: [...(options.activityKinds ?? DISCOVERY_ACTIVITY_KINDS)],
            limit: options.authorScanLimit ?? DISCOVERY_AUTHOR_SCAN_LIMIT,
            since:
              now -
              (options.activeWindowSeconds ?? DISCOVERY_ACTIVE_WINDOW_SECONDS),
          },
        );

        // Activity arrives newest-first, so first sight of an author is their
        // latest activity and map order is newest-activity-first.
        const lastActiveByAuthor = new Map<Pubkey, UnixSeconds>();
        for (const event of activityEvents) {
          if (!lastActiveByAuthor.has(event.pubkey)) {
            lastActiveByAuthor.set(event.pubkey, event.created_at);
          }
        }
        if (lastActiveByAuthor.size === 0) {
          return { result: [], eventIds: [] };
        }

        const authors = [...lastActiveByAuthor.keys()];
        const profileEvents = (yield* Effect.forEach(
          chunkAuthors(authors),
          (chunk) =>
            fetchPlainEvents(context.transport, relays, {
              authors: chunk,
              kinds: [PROFILE_KIND],
              limit: chunk.length * 2,
            }),
          { concurrency: 4 },
        )).flat();

        const discovered: Array<DiscoveredProfile> = [];
        const eventIds: Array<EventId> = [];
        for (const [pubkey, lastActiveAt] of lastActiveByAuthor) {
          const ofAuthor = profileEvents.filter(
            (event) => event.pubkey === pubkey,
          );
          const picked = pickNewest(ofAuthor, PROFILE_KIND, decodeProfileEvent);
          if (picked === null) continue;
          discovered.push(
            new DiscoveredProfile({
              pubkey,
              lastActiveAt,
              metadata: picked.fact.metadata,
            }),
          );
          eventIds.push(picked.eventId);
        }
        return { result: discovered, eventIds };
      }).pipe(
        inspectPlainOperation(
          inspector,
          "profiles.discoverActiveProfiles",
          options,
        ),
      );

    const searchProfiles = (
      query: string,
      options: SearchProfilesOptions = {},
    ): Effect.Effect<
      ReadonlyArray<ProfileSearchHit>,
      AllRelaysUnreachable | NoReadRelaysConfigured
    > =>
      Effect.gen(function* () {
        const searchRelays = [...new Set(options.searchRelays ?? [])];
        const relays =
          searchRelays.length > 0
            ? searchRelays
            : context.relayPolicy.readRelays;
        if (relays.length === 0) return yield* new NoReadRelaysConfigured();
        const limit = options.limit ?? PROFILE_SEARCH_DEFAULT_LIMIT;
        const trimmedQuery = query.trim();
        if (!trimmedQuery) return { result: [], eventIds: [] };

        const searchQueries = [trimmedQuery, prefixSearchQuery(trimmedQuery)];
        const filters = searchQueries
          .filter((search): search is string => search !== undefined)
          .map(
            (search): Filter => ({
              kinds: [PROFILE_KIND],
              search,
              limit: limit * PROFILE_SEARCH_OVERFETCH_FACTOR,
            }),
          );
        const collector = createProfileSearchCollector(trimmedQuery, {
          preferredDomains: options.preferredDomains ?? [],
        });
        const failures: Array<RelayRejection> = [];
        let answered = 0;

        const fetchOne = ([relay, filter]: readonly [RelayUrl, Filter]) =>
          context.transport.fetch(relay, filter).pipe(
            Effect.tap((events) =>
              Effect.sync(() => {
                answered += 1;
                collector.add(relay, events);
                options.onHits?.(collector.top(limit).map(({ hit }) => hit));
              }),
            ),
            Effect.catchAll((failure) =>
              Effect.sync(() => {
                failures.push(
                  new RelayRejection({
                    relay: failure.relay,
                    detail: failure.detail,
                  }),
                );
              }),
            ),
          );
        // Whatever arrived by the deadline is the answer; the slow tail is
        // interrupted rather than awaited.
        yield* Effect.forEach(
          relays.flatMap((relay) =>
            filters.map((filter) => [relay, filter] as const),
          ),
          fetchOne,
          { concurrency: "unbounded", discard: true },
        ).pipe(
          Effect.timeoutOption(options.deadline ?? PROFILE_SEARCH_DEADLINE),
        );

        if (answered === 0) {
          return yield* new AllRelaysUnreachable({ failures });
        }
        const kept = collector.top(limit);
        return {
          result: kept.map(({ hit }) => hit),
          eventIds: kept.map(({ eventId }) => eventId),
        };
      }).pipe(
        inspectPlainOperation(inspector, "profiles.searchProfiles", {
          query,
          limit: options.limit,
          searchRelays: options.searchRelays,
        }),
      );

    return {
      publishProfile,
      publishStatus,
      fetchProfile,
      fetchProfiles,
      discoverActiveProfiles,
      searchProfiles,
    } as const;
  }),
}) {}
