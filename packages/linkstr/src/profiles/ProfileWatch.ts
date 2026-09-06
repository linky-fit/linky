import { Duration, Effect, Either, Option, Queue, Stream } from "effect";
import type { Scope } from "effect";
import type { Filter } from "nostr-tools";
import { NoReadRelaysConfigured } from "../domain/errors";
import type { Pubkey, RelayUrl } from "../domain/primitives";
import { Inspector } from "../inspector/Inspector";
import { ProfileWatchRouted } from "../inspector/events";
import { chunkAuthors } from "../internal/authorChunks";
import type { SignedPlainEvent } from "../internal/nostrEvent";
import { firstTagValue } from "../internal/nostrEvent";
import { decodeVerifiedPlainEvent } from "../internal/plainEvent";
import { resubscribeForever } from "../internal/resubscribe";
import { nowSeconds } from "../internal/time";
import { NostrTransport } from "../services/NostrTransport";
import { RelayPolicy } from "../services/RelayPolicy";
import {
  decodeProfileEvent,
  decodeStatusEvent,
  PROFILE_KIND,
  STATUS_D_GENERAL,
  STATUS_KIND,
} from "./codec";
import { ProfileEventDropped } from "./events";
import type { ProfileDropReason, ProfileWatchEvent } from "./events";

export interface ProfileWatchOptions {
  /** Base delay of the per-relay resubscribe backoff. */
  readonly resubscribeDelay?: Duration.Duration;
}

const DEFAULT_RESUBSCRIBE_DELAY = Duration.seconds(5);

/**
 * Long-lived profile subscription: `{ kinds: [0, 30315], authors }` filters
 * on every read relay for a fixed pubkey set, authors split at
 * `AUTHOR_FILTER_LIMIT` so no filter exceeds what relays accept. Newest-wins
 * per (pubkey, kind) — in-session only, so a lagging relay can never
 * downgrade what a faster one already delivered; kind 30315 tracks the
 * `d=general` slot only. `watch` is a scoped resource; watching a different
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

          const watched = new Set<string>(pubkeys);
          const filters: Array<Filter> = chunkAuthors([...watched]).map(
            (authors) => ({
              kinds: [PROFILE_KIND, STATUS_KIND],
              authors,
            }),
          );
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

          const newestSeen = new Map<string, number>();
          const isStale = (event: SignedPlainEvent): boolean => {
            const best = newestSeen.get(`${event.pubkey}:${event.kind}`);
            return best !== undefined && event.created_at <= best;
          };

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
                  inspector.emit(
                    () =>
                      new ProfileWatchRouted(
                        {
                          eventId: null,
                          kind: null,
                          event: new ProfileEventDropped({
                            eventId: null,
                            reason,
                          }),
                        },
                        { disableValidation: true },
                      ),
                  );
                  return Option.none<ProfileWatchEvent>();
                }),
              onRight: (event) =>
                Effect.map(route(event), (routed) =>
                  Either.match(routed, {
                    onLeft: (reason) => {
                      inspector.emit(
                        () =>
                          new ProfileWatchRouted(
                            {
                              eventId: event.id,
                              kind: event.kind,
                              event: new ProfileEventDropped({
                                eventId: event.id,
                                reason,
                              }),
                            },
                            { disableValidation: true },
                          ),
                      );
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

          return Stream.fromQueue(rawEvents).pipe(
            Stream.mapEffect(processRaw),
            Stream.filterMap((event) => event),
          );
        });

      return { watch } as const;
    }),
  },
) {}
