import {
  Duration,
  Effect,
  Either,
  Option,
  Queue,
  Ref,
  Schema,
  Stream,
} from "effect";
import type { Scope } from "effect";
import type { Filter } from "nostr-tools";
import type { BankOfferInboxEvent } from "../bankOffers/events";
import type { ChatInboxEvent } from "../chat/events";
import type { AllRelaysUnreachable } from "../domain/errors";
import { NoReadRelaysConfigured } from "../domain/errors";
import { UnixSeconds, WrapId } from "../domain/primitives";
import type { RelayUrl } from "../domain/primitives";
import { Inspector } from "../inspector/Inspector";
import { InboxRouted, InboxWrapDeduped } from "../inspector/events";
import { inspectPlainOperation } from "../internal/inspectPlainOperation";
import type { InspectedPlainResult } from "../internal/inspectPlainOperation";
import { fetchRawEvents } from "../internal/plainFetch";
import { resubscribeForever } from "../internal/resubscribe";
import { nowSeconds } from "../internal/time";
import {
  DEFAULT_SEEN_WRAP_IDS_CAPACITY,
  makeSeenWrapIds,
} from "../internal/seenWrapIds";
import type { PaymentNoticeInboxEvent } from "../paymentNotices/events";
import type { ReactionInboxEvent } from "../reactions/events";
import type { SeenReceiptInboxEvent } from "../seenReceipts/events";
import { LinkstrIdentity } from "../services/LinkstrIdentity";
import { NostrTransport } from "../services/NostrTransport";
import { RelayPolicy } from "../services/RelayPolicy";
import { decodeWrapEvent } from "./decodeWrapEvent";
import { InboxCursorStore } from "./InboxCursorStore";
import { WrapDropped } from "./events";
import type { InboxDelivery } from "./events";

export type WrapInboxEvent =
  | BankOfferInboxEvent
  | ReactionInboxEvent
  | ChatInboxEvent
  | PaymentNoticeInboxEvent
  | SeenReceiptInboxEvent
  | WrapDropped;

/**
 * Stream element of `WrapInboxFeed`: the routed inbox fact plus the receive
 * phase captured when the wrap first arrived — the first relay to deliver a
 * wrap decides its phase, cross-relay duplicates are dropped either way. The
 * codecs stay delivery-agnostic; only the inbox machine knows the boundary.
 */
export interface DeliveredInboxEvent {
  readonly delivery: InboxDelivery;
  readonly event: WrapInboxEvent;
}

export interface WrapInboxOptions {
  /** Backfill start when the `InboxCursorStore` holds no cursor yet. */
  readonly since?: UnixSeconds;
  /** Base delay of the per-relay resubscribe backoff. */
  readonly resubscribeDelay?: Duration.Duration;
}

export interface WrapFetchOptions {
  readonly extraRelays?: ReadonlyArray<RelayUrl>;
  /**
   * Bounds the whole fan-out; on timeout the fetch resolves null instead of
   * failing. For callers on an external deadline (push events), since a
   * reachable-but-silent relay can hold the fetch for ~11s otherwise.
   */
  readonly timeout?: Duration.DurationInput;
}

export interface WrapInboxFeed {
  /** Single-consumer: fan out downstream if multiple listeners are needed. */
  readonly events: Stream.Stream<DeliveredInboxEvent>;
}

interface RawArrival {
  readonly delivery: InboxDelivery;
  readonly raw: unknown;
}

const GIFT_WRAP_KIND = 1059;

/** NIP-59 wraps carry timestamps randomized up to two days into the past. */
export const NIP59_BACKDATE_MARGIN_SECONDS = 2 * 24 * 60 * 60;

const DEFAULT_RESUBSCRIBE_DELAY = Duration.seconds(5);

const decodeWrapIdField = Schema.decodeUnknownEither(
  Schema.Struct({ id: WrapId }),
);

const wrapIdOf = (raw: unknown): WrapId | null =>
  Either.match(decodeWrapIdField(raw), {
    onLeft: () => null,
    onRight: ({ id }) => id,
  });

/**
 * Owns the app's single kind-1059 subscription: one filter per read relay,
 * wraps deduped across relays, authenticated and routed by rumor kind into
 * typed inbox facts. Each relay runs its own resubscribe loop, so one dead
 * relay never stalls the others; every (re)subscription backfills from the
 * cursor minus the NIP-59 backdate margin. The cursor is loaded from and
 * checkpointed to `InboxCursorStore` — the backdate margin makes eager
 * checkpointing safe, since the next session refetches everything the
 * current one could still deliver.
 */
export class WrapInbox extends Effect.Service<WrapInbox>()(
  "linkstr/WrapInbox",
  {
    effect: Effect.gen(function* () {
      const identity = yield* LinkstrIdentity;
      const transport = yield* NostrTransport;
      const relayPolicy = yield* RelayPolicy;
      const cursorStore = yield* InboxCursorStore;
      const inspector = yield* Inspector.orNoop;

      const fetchWrapEvent = (
        wrapId: WrapId,
        options?: WrapFetchOptions,
      ): Effect.Effect<
        WrapInboxEvent | null,
        AllRelaysUnreachable | NoReadRelaysConfigured
      > => {
        const fetched = Effect.gen(function* () {
          const relays = Array.from(
            new Set([
              ...relayPolicy.readRelays,
              ...(options?.extraRelays ?? []),
            ]),
          );
          if (relays.length === 0) return yield* new NoReadRelaysConfigured();
          const raws = yield* fetchRawEvents(transport, relays, {
            ids: [wrapId],
            kinds: [GIFT_WRAP_KIND],
            "#p": [identity.pubkey],
            limit: 1,
          });
          const candidates = raws.filter((raw) => wrapIdOf(raw) === wrapId);
          const decoded = candidates.map((raw) =>
            decodeWrapEvent(raw, identity),
          );
          const routed =
            decoded.find(({ event }) => event._tag !== "WrapDropped") ??
            decoded[0] ??
            null;
          return {
            result: routed?.event ?? null,
            eventIds: routed === null ? [] : [wrapId],
          };
        });
        const bounded =
          options?.timeout === undefined
            ? fetched
            : Effect.timeoutTo(fetched, {
                duration: options.timeout,
                onTimeout: (): InspectedPlainResult<WrapInboxEvent | null> => ({
                  result: null,
                  eventIds: [],
                }),
                onSuccess: (value) => value,
              });
        return bounded.pipe(
          inspectPlainOperation(inspector, "inbox.fetchWrapEvent", {
            wrapId,
            ...options,
          }),
        );
      };

      const open = (
        options?: WrapInboxOptions,
      ): Effect.Effect<WrapInboxFeed, NoReadRelaysConfigured, Scope.Scope> =>
        Effect.gen(function* () {
          const relays = relayPolicy.readRelays;
          if (relays.length === 0) return yield* new NoReadRelaysConfigured();
          const resubscribeDelay =
            options?.resubscribeDelay ?? DEFAULT_RESUBSCRIBE_DELAY;

          const cursor = yield* Ref.make<UnixSeconds | null>(
            (yield* cursorStore.load) ?? options?.since ?? null,
          );
          const rawWraps = yield* Effect.acquireRelease(
            Queue.unbounded<RawArrival>(),
            Queue.shutdown,
          );
          const seenWrapIds = makeSeenWrapIds(DEFAULT_SEEN_WRAP_IDS_CAPACITY);

          const filterFrom = (since: UnixSeconds | null): Filter => ({
            kinds: [GIFT_WRAP_KIND],
            "#p": [identity.pubkey],
            ...(since === null
              ? {}
              : {
                  since: Math.max(since - NIP59_BACKDATE_MARGIN_SECONDS, 0),
                }),
          });

          // The phase is scoped to one subscription attempt: after a
          // reconnect the relay replays its stored window, which is backfill
          // again until its next EOSE.
          const subscribeFromCursor = (relay: RelayUrl) =>
            Effect.gen(function* () {
              const filter = filterFrom(yield* Ref.get(cursor));
              let eoseSeen = false;
              yield* transport.subscribe(
                relay,
                filter,
                (event) => {
                  Queue.unsafeOffer(rawWraps, {
                    delivery: eoseSeen ? "live" : "backfill",
                    raw: event,
                  });
                },
                {
                  onEose: () => {
                    eoseSeen = true;
                  },
                },
              );
            });

          const keepSubscribed = (relay: RelayUrl) =>
            resubscribeForever(subscribeFromCursor(relay), resubscribeDelay);

          yield* Effect.forEach(relays, (relay) =>
            Effect.forkScoped(keepSubscribed(relay)),
          );

          const advanceCursor = (wrapCreatedAt: number): Effect.Effect<void> =>
            Effect.gen(function* () {
              // Clamped: a sender-controlled future timestamp must not push
              // the cursor past real time, or restarts would skip everything
              // published before it.
              const next = Math.min(wrapCreatedAt, yield* nowSeconds);
              const advanced = yield* Ref.modify(cursor, (current) =>
                next > (current ?? 0)
                  ? [UnixSeconds.make(next), UnixSeconds.make(next)]
                  : [null, current],
              );
              if (advanced !== null) yield* cursorStore.save(advanced);
            });

          const processRaw = ({
            delivery,
            raw,
          }: RawArrival): Effect.Effect<Option.Option<DeliveredInboxEvent>> =>
            Effect.suspend(() => {
              const wrapId = wrapIdOf(raw);
              if (wrapId !== null && seenWrapIds.has(wrapId)) {
                return Effect.sync(() => {
                  inspector.emit(
                    () =>
                      new InboxWrapDeduped(
                        { wrapId },
                        { disableValidation: true },
                      ),
                  );
                  return Option.none<DeliveredInboxEvent>();
                });
              }
              const decoded = decodeWrapEvent(raw, identity);
              if (decoded.wrap === null) {
                return Effect.sync(() => {
                  inspector.emit(
                    () =>
                      new InboxRouted(
                        {
                          wrapId: decoded.event.wrapId,
                          rumorKind: null,
                          delivery,
                          event: decoded.event,
                        },
                        { disableValidation: true },
                      ),
                  );
                  return Option.some<DeliveredInboxEvent>({
                    delivery,
                    event: decoded.event,
                  });
                });
              }
              const { wrap } = decoded;
              return Effect.sync(() => seenWrapIds.add(wrap.id)).pipe(
                Effect.andThen(advanceCursor(wrap.created_at)),
                Effect.map(() => {
                  inspector.emit(
                    () =>
                      new InboxRouted(
                        {
                          wrapId: wrap.id,
                          rumorKind: decoded.rumorKind,
                          delivery,
                          event: decoded.event,
                        },
                        { disableValidation: true },
                      ),
                  );
                  return Option.some<DeliveredInboxEvent>({
                    delivery,
                    event: decoded.event,
                  });
                }),
              );
            });

          const events = Stream.fromQueue(rawWraps).pipe(
            Stream.mapEffect(processRaw),
            Stream.filterMap((event) => event),
          );

          return { events };
        });

      return { fetchWrapEvent, open } as const;
    }),
  },
) {}
