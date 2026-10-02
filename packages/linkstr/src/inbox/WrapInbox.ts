import {
  Deferred,
  Duration,
  Effect,
  Either,
  Exit,
  Option,
  Queue,
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
import {
  InboxRouted,
  InboxWalkGivenUp,
  InboxWrapDeduped,
} from "../inspector/events";
import { inspectPlainOperation } from "../internal/inspectPlainOperation";
import { redactInspectorSecrets } from "../internal/redactInspectorSecrets";
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
  /** The gift wrap the event came in; null when the outer event was malformed. */
  readonly wrapId: WrapId | null;
  readonly delivery: InboxDelivery;
  readonly event: WrapInboxEvent;
  /**
   * Confirms that the consumer has handled and stored the event. The cursor
   * never passes an unconfirmed event; confirming twice is a no-op.
   */
  readonly ack: Effect.Effect<void>;
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

/** The backfill never reaches further back than this, however old the cursor. */
export const MAX_BACKFILL_AGE_SECONDS = 30 * 24 * 60 * 60;

const BACKFILL_PAGE_LIMIT = 200;

/** A relay whose attempts end this many times in a row before its walk finishes stops holding the cursor. */
const MAX_FAILED_WALK_ATTEMPTS = 3;

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
 * relay never stalls the others. Every (re)subscription opens a live
 * subscription, then walks the relay's stored wraps back in pages to the
 * cursor minus the NIP-59 backdate margin, so relay result caps never
 * truncate the backfill. The cursor is loaded from and checkpointed to
 * `InboxCursorStore`, and only moves once no read relay has a walk left to
 * finish (or has failed too often) and the consumer has confirmed every
 * delivered wrap.
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
          const { events: raws } = yield* fetchRawEvents(transport, relays, {
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

          let cursor: UnixSeconds | null =
            (yield* cursorStore.load) ?? options?.since ?? null;
          // Fixed per open, so a relay walking later still reaches wraps others confirmed meanwhile.
          const since = Math.max(
            (cursor ?? 0) - NIP59_BACKDATE_MARGIN_SECONDS,
            (yield* nowSeconds) - MAX_BACKFILL_AGE_SECONDS,
            0,
          );
          let newestConfirmed = 0;
          let outstanding = 0;
          // Relays that have not finished a walk since it last started; every
          // read relay starts here, so one that is slow to answer holds too.
          const walking = new Set<RelayUrl>(relays);
          const unresolvedBoundaries = new Map<RelayUrl, number>();
          let closed = false;
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              closed = true;
            }),
          );
          const rawWraps = yield* Effect.acquireRelease(
            Queue.unbounded<RawArrival>(),
            Queue.shutdown,
          );
          const seenWrapIds = makeSeenWrapIds(DEFAULT_SEEN_WRAP_IDS_CAPACITY);

          const arrive = (arrival: RawArrival): void => {
            if (Queue.unsafeOffer(rawWraps, arrival)) outstanding++;
          };

          // Relays deliver out of order and walks newest first, so the cursor
          // moves only once no walk runs and every delivered wrap is confirmed.
          const advanceWhenSettled = Effect.suspend(() => {
            if (closed || outstanding > 0 || walking.size > 0)
              return Effect.void;
            const confirmed = Math.min(
              newestConfirmed,
              ...unresolvedBoundaries.values(),
            );
            if (confirmed <= (cursor ?? 0)) return Effect.void;
            const next = UnixSeconds.make(confirmed);
            cursor = next;
            return cursorStore.save(next);
          });

          const settle = (wrapCreatedAt: number | null): Effect.Effect<void> =>
            Effect.gen(function* () {
              if (wrapCreatedAt !== null) {
                // Clamped: a sender-controlled future timestamp must not push
                // the cursor past real time, or restarts would skip everything
                // published before it.
                newestConfirmed = Math.max(
                  newestConfirmed,
                  Math.min(wrapCreatedAt, yield* nowSeconds),
                );
              }
              outstanding--;
              yield* advanceWhenSettled;
            });

          const ackOnce = (
            wrapCreatedAt: number | null,
          ): Effect.Effect<void> => {
            let acked = false;
            return Effect.suspend(() => {
              if (acked) return Effect.void;
              acked = true;
              return settle(wrapCreatedAt);
            });
          };

          const wrapFilter = (window: Filter): Filter => ({
            kinds: [GIFT_WRAP_KIND],
            "#p": [identity.pubkey],
            ...window,
          });

          // Inclusive pages retain timestamp ties; a saturated boundary holds the cursor there.
          const walkBack = (relay: RelayUrl) =>
            Effect.gen(function* () {
              walking.add(relay);
              const delivered = new Set<string>();
              let until: number | null = null;
              let limit = BACKFILL_PAGE_LIMIT;
              let largestPage = 0;
              let unresolvedBoundary = Number.POSITIVE_INFINITY;
              for (;;) {
                const page = yield* transport.fetch(
                  relay,
                  wrapFilter({
                    since,
                    ...(until === null ? {} : { until }),
                    limit,
                  }),
                );
                largestPage = Math.max(largestPage, page.length);
                const fresh = page.filter((raw) => !delivered.has(raw.id));
                for (const raw of fresh) {
                  delivered.add(raw.id);
                  arrive({ delivery: "backfill", raw });
                }
                const times = page
                  .map((raw) => raw.created_at)
                  .filter(Number.isInteger);
                if (times.length === 0) break;
                const oldest = Math.min(...times);
                if (until !== null && oldest >= until) {
                  if (page.length === largestPage) {
                    if (limit === BACKFILL_PAGE_LIMIT) {
                      limit *= 2;
                      continue;
                    }
                    unresolvedBoundary = Math.min(unresolvedBoundary, until);
                    unresolvedBoundaries.set(
                      relay,
                      Math.min(
                        unresolvedBoundaries.get(relay) ?? unresolvedBoundary,
                        unresolvedBoundary,
                      ),
                    );
                  }
                  until--;
                } else {
                  until = oldest;
                }
                limit = BACKFILL_PAGE_LIMIT;
                if (until < since) break;
              }
              if (Number.isFinite(unresolvedBoundary))
                unresolvedBoundaries.set(relay, unresolvedBoundary);
              else unresolvedBoundaries.delete(relay);
              walking.delete(relay);
              yield* advanceWhenSettled;
            });

          // The live subscription asks for one stored wrap only: some relays
          // never answer `limit: 0` with EOSE. Its EOSE starts the walk, so a
          // wrap published meanwhile arrives live. The phase is scoped to one
          // attempt: after a reconnect, wraps are backfill until the next EOSE.
          const subscribeAndWalk = (relay: RelayUrl) =>
            Effect.gen(function* () {
              const subscribed = yield* Deferred.make<void>();
              let eoseSeen = false;
              const live = transport.subscribe(
                relay,
                wrapFilter({ since, limit: 1 }),
                (event) =>
                  arrive({
                    delivery: eoseSeen ? "live" : "backfill",
                    raw: event,
                  }),
                {
                  onEose: () => {
                    eoseSeen = true;
                    Deferred.unsafeDone(subscribed, Exit.void);
                  },
                },
              );
              const backfill = Deferred.await(subscribed).pipe(
                Effect.zipRight(walkBack(relay)),
                Effect.zipRight(Effect.never),
              );
              yield* Effect.raceFirst(live, backfill);
            });

          const keepSubscribed = (relay: RelayUrl) => {
            let failedAttempts = 0;
            const afterAttempt = Effect.suspend(() => {
              if (!walking.has(relay)) {
                failedAttempts = 0;
                return Effect.void;
              }
              failedAttempts++;
              if (failedAttempts < MAX_FAILED_WALK_ATTEMPTS) return Effect.void;
              walking.delete(relay);
              inspector.emit(
                () =>
                  new InboxWalkGivenUp(
                    { relay, failedAttempts },
                    { disableValidation: true },
                  ),
              );
              return advanceWhenSettled;
            });
            return resubscribeForever(
              Effect.zipRight(
                Effect.exit(subscribeAndWalk(relay)),
                afterAttempt,
              ),
              resubscribeDelay,
            );
          };

          yield* Effect.forEach(relays, (relay) =>
            Effect.forkScoped(keepSubscribed(relay)),
          );

          const routed = (
            wrapId: WrapId | null,
            rumorKind: number | null,
            delivery: InboxDelivery,
            event: WrapInboxEvent,
            ack: Effect.Effect<void>,
          ): Option.Option<DeliveredInboxEvent> => {
            inspector.emit(
              () =>
                new InboxRouted(
                  {
                    wrapId,
                    rumorKind,
                    delivery,
                    event: redactInspectorSecrets(event),
                  },
                  { disableValidation: true },
                ),
            );
            return Option.some({ wrapId, delivery, event, ack });
          };

          const processRaw = ({
            delivery,
            raw,
          }: RawArrival): Effect.Effect<Option.Option<DeliveredInboxEvent>> =>
            Effect.suspend(() => {
              const wrapId = wrapIdOf(raw);
              if (wrapId !== null && seenWrapIds.has(wrapId)) {
                inspector.emit(
                  () =>
                    new InboxWrapDeduped(
                      { wrapId },
                      { disableValidation: true },
                    ),
                );
                return Effect.as(settle(null), Option.none());
              }
              const decoded = decodeWrapEvent(raw, identity);
              if (decoded.wrap === null) {
                return Effect.succeed(
                  routed(
                    decoded.event.wrapId,
                    null,
                    delivery,
                    decoded.event,
                    ackOnce(null),
                  ),
                );
              }
              const { wrap } = decoded;
              seenWrapIds.add(wrap.id);
              return Effect.succeed(
                routed(
                  wrap.id,
                  decoded.rumorKind,
                  delivery,
                  decoded.event,
                  ackOnce(wrap.created_at),
                ),
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
