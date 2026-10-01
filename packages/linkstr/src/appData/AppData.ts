import {
  Context,
  Duration,
  Effect,
  Filter,
  Layer,
  Option,
  Queue,
  Result,
  Stream,
} from "effect";
import type { Cause, Scope } from "effect";
import type { PlainEventReceipt } from "../domain/delivery";
import type {
  AllRelaysUnreachable,
  NoRelayAcceptedEvent,
} from "../domain/errors";
import { NoReadRelaysConfigured } from "../domain/errors";
import type { RelayUrl } from "../domain/primitives";
import { Inspector } from "../inspector/Inspector";
import { inspectPlainOperation } from "../internal/inspectPlainOperation";
import { deliverPlainEvent } from "../internal/plainDelivery";
import { decodeVerifiedPlainEvent } from "../internal/plainEvent";
import { fetchRawEvents, toPlainEvents } from "../internal/plainFetch";
import { resubscribeForever } from "../internal/resubscribe";
import { acquireStreamQueue } from "../internal/streamQueue";
import { LinkstrIdentity } from "../services/LinkstrIdentity";
import { NostrTransport } from "../services/NostrTransport";
import { RelayPolicy } from "../services/RelayPolicy";
import {
  appDataFilter,
  decodeAppDataEvent,
  encodeAppDataEvent,
  matchesQuery,
  slotOf,
} from "./codec";
import type { AppDataDraft, AppDataEvent, AppDataQuery } from "./domain";

const FETCH_PER_RELAY_TIMEOUT = Duration.seconds(5);
const DEFAULT_RESUBSCRIBE_DELAY = Duration.seconds(5);

export interface AppDataWatchOptions {
  /** Base delay of the per-relay resubscribe backoff. */
  readonly resubscribeDelay?: Duration.Duration;
}

/**
 * NIP-78 (kind 30078) app data: publish one addressable event per `d` tag
 * under the configured identity, and fetch or watch any author's. Events are
 * public and signature-verified; per author and `d` tag only the newest
 * counts, so a lagging relay never replaces a newer one.
 */
export class AppData extends Context.Service<AppData>()("linkstr/AppData", {
  make: Effect.gen(function* () {
    const context = {
      identity: yield* LinkstrIdentity,
      transport: yield* NostrTransport,
      relayPolicy: yield* RelayPolicy,
    };
    const inspector = yield* Inspector.orNoop;

    const readRelays: Effect.Effect<
      ReadonlyArray<RelayUrl>,
      NoReadRelaysConfigured
    > = Effect.suspend(() =>
      context.relayPolicy.readRelays.length === 0
        ? new NoReadRelaysConfigured()
        : Effect.succeed(context.relayPolicy.readRelays),
    );

    const publish = (
      draft: AppDataDraft,
    ): Effect.Effect<PlainEventReceipt, NoRelayAcceptedEvent> =>
      deliverPlainEvent(context, encodeAppDataEvent(draft)).pipe(
        Effect.map((receipt) => ({
          result: receipt,
          eventIds: [receipt.eventId],
        })),
        inspectPlainOperation(inspector, "appData.publish", {
          identifier: draft.identifier,
          tags: draft.tags,
        }),
      );

    /** The newest event per author and `d` tag, newest first. */
    const fetch = (
      query: AppDataQuery,
    ): Effect.Effect<
      ReadonlyArray<AppDataEvent>,
      AllRelaysUnreachable | NoReadRelaysConfigured
    > =>
      Effect.gen(function* () {
        const { events } = yield* fetchRawEvents(
          context.transport,
          yield* readRelays,
          appDataFilter(query),
          { perRelayTimeout: FETCH_PER_RELAY_TIMEOUT },
        );
        const newest = new Map<string, AppDataEvent>();
        for (const event of toPlainEvents(events)) {
          const decoded = decodeAppDataEvent(event);
          if (
            decoded !== null &&
            matchesQuery(decoded, query) &&
            !newest.has(slotOf(decoded))
          ) {
            newest.set(slotOf(decoded), decoded);
          }
        }
        const result = [...newest.values()];
        return { result, eventIds: result.map((event) => event.eventId) };
      }).pipe(inspectPlainOperation(inspector, "appData.fetch", query));

    /**
     * Stored and live events matching `query` on every read relay, each
     * slot's newer versions only. A scoped resource: closing the scope ends
     * the subscriptions.
     */
    const watch = (
      query: AppDataQuery,
      options?: AppDataWatchOptions,
    ): Effect.Effect<
      Stream.Stream<AppDataEvent>,
      NoReadRelaysConfigured,
      Scope.Scope
    > =>
      Effect.gen(function* () {
        const relays = yield* readRelays;
        const filter = appDataFilter(query);
        const raw = yield* acquireStreamQueue(
          Queue.unbounded<unknown, Cause.Done>(),
        );
        yield* Effect.forEach(relays, (relay) =>
          Effect.forkScoped(
            resubscribeForever(
              context.transport.subscribe(relay, filter, (event) => {
                Queue.offerUnsafe(raw, event);
              }),
              options?.resubscribeDelay ?? DEFAULT_RESUBSCRIBE_DELAY,
            ),
          ),
        );
        const newestSeen = new Map<string, number>();
        const isNewer = (event: AppDataEvent): boolean => {
          const seen = newestSeen.get(slotOf(event));
          if (seen !== undefined && event.createdAt <= seen) return false;
          newestSeen.set(slotOf(event), event.createdAt);
          return true;
        };
        return Stream.fromQueue(raw).pipe(
          Stream.filterMap(
            Filter.fromPredicateOption((event) =>
              Result.match(decodeVerifiedPlainEvent(event), {
                onFailure: () => Option.none<AppDataEvent>(),
                onSuccess: (verified) =>
                  Option.fromNullishOr(decodeAppDataEvent(verified)),
              }),
            ),
          ),
          Stream.filter(
            (event) => matchesQuery(event, query) && isNewer(event),
          ),
        );
      });

    return { publish, fetch, watch } as const;
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
