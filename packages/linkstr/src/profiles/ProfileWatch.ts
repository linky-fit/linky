import { Duration, Effect, Either, Option, Queue, Stream } from "effect";
import type { Scope } from "effect";
import type { Filter } from "nostr-tools";
import { NoReadRelaysConfigured } from "../domain/errors";
import type { EventId, Pubkey, RelayUrl } from "../domain/primitives";
import { Inspector } from "../inspector/Inspector";
import { ProfileWatchRouted } from "../inspector/events";
import type { SignedPlainEvent } from "../internal/nostrEvent";
import { firstTagValue } from "../internal/nostrEvent";
import { decodeVerifiedPlainEvent } from "../internal/plainEvent";
import { fetchRawEvents } from "../internal/plainFetch";
import { resubscribeForever } from "../internal/resubscribe";
import { nowSeconds } from "../internal/time";
import { NostrTransport } from "../services/NostrTransport";
import { RelayPolicy } from "../services/RelayPolicy";
import {
  BADGE_AWARD_KIND,
  PROFILE_BADGES_D,
  PROFILE_BADGES_KIND,
  supporterBadgeAddress,
  supporterBadgeEntries,
  verifySupporterAward,
} from "../supporterBadges/codec";
import type { SupporterAward } from "../supporterBadges/domain";
import {
  decodeProfileEvent,
  decodeStatusEvent,
  PROFILE_KIND,
  STATUS_D_GENERAL,
  STATUS_KIND,
} from "./codec";
import { ProfileEventDropped, SupporterBadgesUpdated } from "./events";
import type { ProfileDropReason, ProfileWatchEvent } from "./events";
import { profileBadgesFilters, profileFilters } from "./filters";

export interface ProfileWatchOptions {
  /** Base delay of the per-relay resubscribe backoff. */
  readonly resubscribeDelay?: Duration.Duration;
  /**
   * Also watch profile badges (kind 30008) and emit `SupporterBadgesUpdated`
   * with the supporter badges this pubkey issued.
   */
  readonly supporterBadgeIssuer?: Pubkey;
}

const DEFAULT_RESUBSCRIBE_DELAY = Duration.seconds(5);

/** A silent relay must not hold back a contact's badges for long. */
const AWARD_FETCH_PER_RELAY_TIMEOUT = Duration.seconds(4);

/**
 * Long-lived profile subscription: one kind 0 and one kind 30315 filter per
 * author chunk on every read relay for a fixed pubkey set, authors split at
 * `AUTHOR_FILTER_LIMIT` so no filter exceeds what relays accept. Newest-wins
 * per (pubkey, kind) — in-session only, so a lagging relay can never
 * downgrade what a faster one already delivered; kind 30315 tracks the
 * `d=general` slot only. With a supporter badge issuer, kind 30008 events
 * run through their own pipeline, so fetching their awards never delays
 * profiles. `watch` is a scoped resource; watching a different
 * set means closing the scope and calling it again (the react boundary does
 * exactly that).
 */
export class ProfileWatch extends Effect.Service<ProfileWatch>()(
  "linkstr/ProfileWatch",
  {
    effect: Effect.gen(function* () {
      const transport = yield* NostrTransport;
      const relayPolicy = yield* RelayPolicy;
      const inspector = yield* Inspector.orNoop;

      const watch = (
        pubkeys: ReadonlyArray<Pubkey>,
        options?: ProfileWatchOptions,
      ): Effect.Effect<
        Stream.Stream<ProfileWatchEvent>,
        NoReadRelaysConfigured,
        Scope.Scope
      > =>
        Effect.gen(function* () {
          const relays = relayPolicy.readRelays;
          if (relays.length === 0) return yield* new NoReadRelaysConfigured();
          if (pubkeys.length === 0) return Stream.empty;
          const resubscribeDelay =
            options?.resubscribeDelay ?? DEFAULT_RESUBSCRIBE_DELAY;

          const issuer = options?.supporterBadgeIssuer;

          const watched = new Set<Pubkey>(pubkeys);
          const subscribeAll = (filters: ReadonlyArray<Filter>) =>
            Effect.gen(function* () {
              const rawEvents = yield* Effect.acquireRelease(
                Queue.unbounded<unknown>(),
                Queue.shutdown,
              );
              const keepSubscribed = (relay: RelayUrl, filter: Filter) =>
                resubscribeForever(
                  transport.subscribe(relay, filter, (event) => {
                    Queue.unsafeOffer(rawEvents, event);
                  }),
                  resubscribeDelay,
                );
              yield* Effect.forEach(relays, (relay) =>
                Effect.forEach(filters, (filter) =>
                  Effect.forkScoped(keepSubscribed(relay, filter)),
                ),
              );
              return rawEvents;
            });

          const newestSeen = new Map<string, number>();
          const isStale = (event: SignedPlainEvent): boolean => {
            const best = newestSeen.get(`${event.pubkey}:${event.kind}`);
            return best !== undefined && event.created_at <= best;
          };

          const dropped = (
            eventId: EventId | null,
            kind: number | null,
            reason: ProfileDropReason,
          ): void =>
            inspector.emit(
              () =>
                new ProfileWatchRouted(
                  {
                    eventId,
                    kind,
                    event: new ProfileEventDropped({ eventId, reason }),
                  },
                  { disableValidation: true },
                ),
            );

          const verifiedSupporterBadges = (
            event: SignedPlainEvent,
            badgeIssuer: Pubkey,
          ): Effect.Effect<
            Either.Either<SupporterBadgesUpdated, ProfileDropReason>
          > =>
            Effect.gen(function* () {
              const entries = supporterBadgeEntries(event.tags, badgeIssuer);
              const fetched =
                entries.length === 0
                  ? Either.right({ events: [], failures: [] })
                  : yield* Effect.either(
                      fetchRawEvents(
                        transport,
                        relays,
                        {
                          ids: entries.map(({ awardId }) => awardId),
                          kinds: [BADGE_AWARD_KIND],
                          authors: [badgeIssuer],
                        },
                        { perRelayTimeout: AWARD_FETCH_PER_RELAY_TIMEOUT },
                      ),
                    );
              if (Either.isLeft(fetched))
                return Either.left("awards-unreachable");
              const { events, failures } = fetched.right;
              const copiesOf = (awardId: EventId) =>
                events.filter(({ id }) => id === awardId);
              // A relay that did not answer may hold the missing award.
              if (
                failures.length > 0 &&
                entries.some(({ awardId }) => copiesOf(awardId).length === 0)
              )
                return Either.left("awards-unreachable");
              const awards: Array<SupporterAward> = [];
              for (const { address, awardId } of entries) {
                const attempts = copiesOf(awardId).map((raw) =>
                  Either.filterOrLeft(
                    verifySupporterAward(raw, badgeIssuer, event.pubkey),
                    (award) =>
                      supporterBadgeAddress(badgeIssuer, award.badge) ===
                      address,
                    (): ProfileDropReason => "award-mismatch",
                  ),
                );
                const verified: Either.Either<
                  SupporterAward,
                  ProfileDropReason
                > =
                  attempts.find(Either.isRight) ??
                  attempts[0] ??
                  Either.left("award-missing");
                Either.match(verified, {
                  onLeft: (reason) =>
                    dropped(awardId, BADGE_AWARD_KIND, reason),
                  onRight: (award) => awards.push(award),
                });
              }
              return Either.right(
                new SupporterBadgesUpdated({
                  pubkey: event.pubkey,
                  awards,
                  updatedAt: event.created_at,
                }),
              );
            });

          const route = (
            event: SignedPlainEvent,
          ): Effect.Effect<
            Either.Either<ProfileWatchEvent, ProfileDropReason>
          > =>
            Effect.gen(function* () {
              if (!watched.has(event.pubkey)) {
                return Either.left("unwatched-author");
              }
              switch (event.kind) {
                case PROFILE_KIND:
                  return isStale(event)
                    ? Either.left("stale")
                    : decodeProfileEvent(event);
                case STATUS_KIND: {
                  if (firstTagValue(event.tags, "d") !== STATUS_D_GENERAL) {
                    return Either.left("other-d-tag");
                  }
                  if (isStale(event)) return Either.left("stale");
                  return decodeStatusEvent(event, yield* nowSeconds);
                }
                case PROFILE_BADGES_KIND: {
                  if (issuer === undefined)
                    return Either.left("unsupported-kind");
                  if (firstTagValue(event.tags, "d") !== PROFILE_BADGES_D) {
                    return Either.left("other-d-tag");
                  }
                  if (isStale(event)) return Either.left("stale");
                  return yield* verifiedSupporterBadges(event, issuer);
                }
                default:
                  return Either.left("unsupported-kind");
              }
            });

          const processRaw = (
            raw: unknown,
          ): Effect.Effect<Option.Option<ProfileWatchEvent>> =>
            Either.match(decodeVerifiedPlainEvent(raw), {
              onLeft: (reason) =>
                Effect.sync(() => {
                  dropped(null, null, reason);
                  return Option.none<ProfileWatchEvent>();
                }),
              onRight: (event) =>
                Effect.map(route(event), (routed) =>
                  Either.match(routed, {
                    onLeft: (reason) => {
                      dropped(event.id, event.kind, reason);
                      return Option.none<ProfileWatchEvent>();
                    },
                    onRight: (fact) => {
                      newestSeen.set(
                        `${event.pubkey}:${event.kind}`,
                        event.created_at,
                      );
                      inspector.emit(
                        () =>
                          new ProfileWatchRouted(
                            {
                              eventId: event.id,
                              kind: event.kind,
                              event: fact,
                            },
                            { disableValidation: true },
                          ),
                      );
                      return Option.some(fact);
                    },
                  }),
                ),
            });

          const routed = (rawEvents: Queue.Dequeue<unknown>) =>
            Stream.fromQueue(rawEvents).pipe(
              Stream.mapEffect(processRaw),
              Stream.filterMap((event) => event),
            );
          const profiles = routed(
            yield* subscribeAll(profileFilters([...watched])),
          );
          if (issuer === undefined) return profiles;
          return Stream.merge(
            profiles,
            routed(yield* subscribeAll(profileBadgesFilters([...watched]))),
          );
        });

      return { watch } as const;
    }),
  },
) {}
