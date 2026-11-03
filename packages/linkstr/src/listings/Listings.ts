import {
  Context,
  Duration,
  Effect,
  Layer,
  Option,
  Queue,
  Result,
  Semaphore,
  Stream,
} from "effect";
import type { Cause, Scope } from "effect";
import type { Filter } from "nostr-tools";
import type { PlainEventReceipt } from "../domain/delivery";
import type { NoRelayAcceptedEvent } from "../domain/errors";
import { NoReadRelaysConfigured } from "../domain/errors";
import type { Pubkey, RelayUrl, UnixSeconds } from "../domain/primitives";
import { Inspector } from "../inspector/Inspector";
import { ProfileWatchRouted } from "../inspector/events";
import { subscriptionRequests } from "../internal/authorChunks";
import { inspectPlainOperation } from "../internal/inspectPlainOperation";
import type { SignedPlainEvent } from "../internal/nostrEvent";
import { publishPlainEvent, replacementDate } from "../internal/plainDelivery";
import { decodeVerifiedPlainEvent } from "../internal/plainEvent";
import { resubscribeForever } from "../internal/resubscribe";
import { acquireStreamQueue } from "../internal/streamQueue";
import { LinkstrIdentity } from "../services/LinkstrIdentity";
import { NostrTransport } from "../services/NostrTransport";
import { RelayPolicy } from "../services/RelayPolicy";
import {
  decodeListingsEvent,
  encodeListingsEvents,
  listingsFilters,
} from "./codec";
import type { ListingsDraft } from "./domain";
import { ListingsEventDropped, ListingsUpdated } from "./events";
import type { ListingsDropReason } from "./events";

export interface ListingsWatchOptions {
  /** Base delay of the per-relay resubscribe backoff. */
  readonly resubscribeDelay?: Duration.Duration;
}

const DEFAULT_RESUBSCRIBE_DELAY = Duration.seconds(5);

/**
 * Listings (kind 34133): the addressable event in which an author shares
 * cash intent and listings with chosen contacts only, split into chunks when
 * one event would be too large. `publish` replaces the author's chunks on
 * every write relay and fails unless every chunk reached a relay; `watch`
 * follows a pubkey set and surfaces each author's newest document read
 * through the chunk that carries this identity's slot,
 * newest-wins per author within the session. `watch` is a scoped resource;
 * watching a different set means closing the scope and calling it again.
 */
export class Listings extends Context.Service<Listings>()("linkstr/Listings", {
  make: Effect.gen(function* () {
    const context = {
      identity: yield* LinkstrIdentity,
      transport: yield* NostrTransport,
      relayPolicy: yield* RelayPolicy,
    };
    const inspector = yield* Inspector.orNoop;

    const publications = Semaphore.makeUnsafe(1);
    let publishedAt: UnixSeconds | undefined;
    const publish = (
      draft: ListingsDraft,
    ): Effect.Effect<ReadonlyArray<PlainEventReceipt>, NoRelayAcceptedEvent> =>
      publications.withPermit(
        Effect.gen(function* () {
          const sentAt = yield* replacementDate(publishedAt);
          // Set before sending: a publish that fails halfway may still have replaced some chunks.
          publishedAt = sentAt;
          const receipts = yield* Effect.forEach(
            encodeListingsEvents(draft, context.identity.secretKey),
            (template) => publishPlainEvent(context, template, sentAt),
            { concurrency: "unbounded" },
          );
          return {
            result: receipts,
            eventIds: receipts.map((receipt) => receipt.eventId),
          };
        }).pipe(
          inspectPlainOperation(inspector, "listings.publish", {
            cash: draft.document.cash,
            listings: draft.document.listings.length,
            recipients: draft.recipients.length,
          }),
        ),
      );

    const watch = (
      pubkeys: ReadonlyArray<Pubkey>,
      options?: ListingsWatchOptions,
    ): Effect.Effect<
      Stream.Stream<ListingsUpdated>,
      NoReadRelaysConfigured,
      Scope.Scope
    > =>
      Effect.gen(function* () {
        const relays = context.relayPolicy.readRelays;
        if (relays.length === 0) return yield* new NoReadRelaysConfigured();
        if (pubkeys.length === 0) return Stream.empty;
        const resubscribeDelay =
          options?.resubscribeDelay ?? DEFAULT_RESUBSCRIBE_DELAY;

        const watched = new Set<Pubkey>(pubkeys);
        const requests = subscriptionRequests(listingsFilters([...watched]));
        const rawEvents = yield* acquireStreamQueue(
          Queue.unbounded<unknown, Cause.Done>(),
        );
        const keepSubscribed = (
          relay: RelayUrl,
          filters: ReadonlyArray<Filter>,
        ) =>
          resubscribeForever(
            context.transport.subscribe(relay, filters, (event) => {
              Queue.offerUnsafe(rawEvents, event);
            }),
            resubscribeDelay,
          );
        yield* Effect.forEach(relays, (relay) =>
          Effect.forEach(requests, (filters) =>
            Effect.forkScoped(keepSubscribed(relay, filters)),
          ),
        );

        const newestSeen = new Map<Pubkey, number>();
        const route = (
          event: SignedPlainEvent,
        ): Result.Result<ListingsUpdated, ListingsDropReason> => {
          if (!watched.has(event.pubkey)) {
            return Result.fail("unwatched-author");
          }
          const best = newestSeen.get(event.pubkey);
          if (best !== undefined && event.created_at <= best) {
            return Result.fail("stale");
          }
          return Result.map(
            decodeListingsEvent(event, context.identity.secretKey),
            (document) =>
              new ListingsUpdated({
                pubkey: event.pubkey,
                document,
                updatedAt: event.created_at,
              }),
          );
        };

        const emitRouted = (
          event: SignedPlainEvent | null,
          routed: ListingsUpdated | ListingsEventDropped,
        ) => {
          inspector.emit(
            () =>
              new ProfileWatchRouted(
                {
                  eventId: event?.id ?? null,
                  kind: event?.kind ?? null,
                  event: routed,
                },
                { disableChecks: true },
              ),
          );
        };

        const processRaw = (raw: unknown): Option.Option<ListingsUpdated> =>
          Result.match(decodeVerifiedPlainEvent(raw), {
            onFailure: (reason) => {
              emitRouted(
                null,
                new ListingsEventDropped({ eventId: null, reason }),
              );
              return Option.none();
            },
            onSuccess: (event) =>
              Result.match(route(event), {
                onFailure: (reason) => {
                  emitRouted(
                    event,
                    new ListingsEventDropped({ eventId: event.id, reason }),
                  );
                  return Option.none();
                },
                onSuccess: (fact) => {
                  newestSeen.set(event.pubkey, event.created_at);
                  emitRouted(event, fact);
                  return Option.some(fact);
                },
              }),
          });

        return Stream.fromQueue(rawEvents).pipe(
          Stream.map(processRaw),
          Stream.filter(Option.isSome),
          Stream.map(({ value }) => value),
        );
      });

    return { publish, watch } as const;
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
