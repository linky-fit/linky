import {
  Array as Arr,
  Cause,
  Context,
  Deferred,
  Duration,
  Effect,
  Fiber,
  Filter,
  Layer,
  Option,
  Order,
  Queue,
  Result,
  Stream,
} from "effect";
import type { Scope } from "effect";
import type { Filter as NostrFilter } from "nostr-tools";
import { NoReadRelaysConfigured } from "../domain/errors";
import type { Pubkey, RelayUrl } from "../domain/primitives";
import type { InboxDelivery } from "../inbox/events";
import { resubscribeForever } from "../internal/resubscribe";
import { nowSeconds } from "../internal/time";
import {
  DEFAULT_SEEN_WRAP_IDS_CAPACITY,
  makeSeenWrapIds,
} from "../internal/seenWrapIds";
import { NostrTransport } from "../services/NostrTransport";
import { RelayPolicy } from "../services/RelayPolicy";
import { decodePushWrap } from "./codec";
import type { PushWrap, PushWrapFailure } from "./codec";
import { acquireStreamQueue } from "../internal/streamQueue";

export type { PushWrapFailure } from "./codec";

export interface DeliveredPushWrap {
  readonly delivery: InboxDelivery;
  readonly wrap: PushWrap;
}

export type PushRelayStatusEvent =
  | {
      readonly type: "attempt-ended";
      readonly relay: RelayUrl;
      readonly reason: string;
    }
  | {
      readonly type: "eose";
      readonly relay: RelayUrl;
    };

export interface PushInboxOptions {
  /**
   * The pubkeys to watch, as the current set followed by every change. Each
   * change resubscribes every relay, keeping the old REQs open until the new
   * ones caught up; while the set is empty no REQ is open.
   */
  readonly recipients: Stream.Stream<ReadonlyArray<Pubkey>>;
  /**
   * How far `since` reaches back. Relays match live wraps against it too, so it
   * must cover NIP-59's randomized `created_at` (up to two days in the past).
   */
  readonly lookback: Duration.Duration;
  readonly refreshInterval?: Duration.Duration;
  readonly resubscribeDelay?: Duration.Duration;
  readonly onInvalidWrap?: (failure: PushWrapFailure) => void;
  readonly onRelayStatus?: (event: PushRelayStatusEvent) => void;
}

interface RawArrival {
  readonly delivery: InboxDelivery;
  readonly raw: unknown;
}

const GIFT_WRAP_KIND = 1059;
const DEFAULT_REFRESH_INTERVAL = Duration.minutes(10);
const DEFAULT_RESUBSCRIBE_DELAY = Duration.seconds(5);
// ~17 KB per REQ: well under the common 64–128 KiB websocket message caps, and
// strfry's default 20 REQs per connection still fit 2,500 recipients while a
// recipient change briefly keeps the old and new REQs open together.
const RECIPIENTS_PER_REQ = 250;

/**
 * Identity-free kind-1059 watcher for push infrastructure. It owns one honest
 * subscription per relay for the given recipients, split into REQs of
 * `RECIPIENTS_PER_REQ`, reconnects with a fresh rolling lookback, validates
 * outer events, and dedupes authenticated live wraps across relays. Backfill
 * (at most the newest stored wrap per REQ) is re-emitted per copy for the
 * consumer to suppress.
 */
export class PushInbox extends Context.Service<PushInbox>()(
  "linkstr/PushInbox",
  {
    make: Effect.gen(function* () {
      const transport = yield* NostrTransport;
      const relayPolicy = yield* RelayPolicy;

      const open = (
        options: PushInboxOptions,
      ): Effect.Effect<
        Stream.Stream<DeliveredPushWrap>,
        NoReadRelaysConfigured,
        Scope.Scope
      > =>
        Effect.gen(function* () {
          const relays = relayPolicy.readRelays;
          if (relays.length === 0) return yield* new NoReadRelaysConfigured();
          const rawWraps = yield* acquireStreamQueue(
            Queue.unbounded<RawArrival, Cause.Done>(),
          );
          const seenWrapIds = makeSeenWrapIds(DEFAULT_SEEN_WRAP_IDS_CAPACITY);
          const refreshInterval =
            options.refreshInterval ?? DEFAULT_REFRESH_INTERVAL;
          const resubscribeDelay =
            options.resubscribeDelay ?? DEFAULT_RESUBSCRIBE_DELAY;
          const lookbackSeconds = Math.floor(
            Duration.toMillis(options.lookback) / 1000,
          );

          const subscribe = (
            relay: RelayUrl,
            recipients: ReadonlyArray<Pubkey>,
            settled: Deferred.Deferred<void>,
          ) =>
            Effect.gen(function* () {
              const since = Math.max((yield* nowSeconds) - lookbackSeconds, 0);
              const chunks = Arr.chunksOf(recipients, RECIPIENTS_PER_REQ);
              let chunksBeforeEose = chunks.length;
              const reportAttemptEnded = (reason: string) =>
                Effect.sync(() =>
                  options.onRelayStatus?.({
                    type: "attempt-ended",
                    relay,
                    reason,
                  }),
                );
              const subscribeChunk = (chunk: ReadonlyArray<Pubkey>) => {
                // Backfill is never notified, so the relay sends at most its
                // newest stored wrap; some relays read `limit: 0` as no limit.
                const filter: NostrFilter = {
                  kinds: [GIFT_WRAP_KIND],
                  "#p": [...chunk],
                  since,
                  limit: 1,
                };
                let eoseSeen = false;
                return transport.subscribe(
                  relay,
                  filter,
                  (raw) => {
                    Queue.offerUnsafe(rawWraps, {
                      delivery: eoseSeen ? "live" : "backfill",
                      raw,
                    });
                  },
                  {
                    alreadyHaveEvent: (id) => seenWrapIds.has(id),
                    onEose: () => {
                      if (eoseSeen) return;
                      eoseSeen = true;
                      chunksBeforeEose -= 1;
                      if (chunksBeforeEose === 0) {
                        options.onRelayStatus?.({ type: "eose", relay });
                        Deferred.doneUnsafe(settled, Effect.void);
                      }
                    },
                  },
                );
              };
              // Relays can drop a long-lived REQ without closing the socket, so
              // periodic refresh is the only way to detect a deaf subscription.
              yield* Effect.raceAllFirst(chunks.map(subscribeChunk)).pipe(
                Effect.tap(reportAttemptEnded),
                Effect.tapError((failure) =>
                  reportAttemptEnded(failure.detail ?? "relay unreachable"),
                ),
                Effect.asVoid,
                Effect.timeoutOrElse({
                  duration: refreshInterval,
                  orElse: () => Effect.void,
                }),
              );
            }).pipe(Effect.ensuring(Deferred.succeed(settled, undefined)));

          // Make-before-break: a relay's previous REQs stay open until the new
          // ones caught up, ended or were replaced, so no live wrap slips between.
          const watchRelay = (
            relay: RelayUrl,
            recipients: ReadonlyArray<Pubkey>,
            previous: Fiber.Fiber<never> | undefined,
          ) =>
            Effect.gen(function* () {
              const settled = yield* Deferred.make<void>();
              const fiber = yield* Effect.forkScoped(
                resubscribeForever(
                  subscribe(relay, recipients, settled),
                  resubscribeDelay,
                ),
              );
              if (previous !== undefined) {
                yield* Effect.raceFirst(
                  Deferred.await(settled),
                  Fiber.await(fiber),
                ).pipe(
                  Effect.andThen(Fiber.interrupt(previous)),
                  Effect.forkScoped,
                );
              }
              return fiber;
            });

          let watching: ReadonlyArray<Fiber.Fiber<never>> = [];
          yield* options.recipients.pipe(
            Stream.map((recipients) =>
              Arr.sort(Arr.dedupe(recipients), Order.String),
            ),
            Stream.changesWith((a, b) => a.join() === b.join()),
            Stream.runForEach((recipients) =>
              Effect.gen(function* () {
                const previous = watching;
                if (recipients.length === 0) {
                  watching = [];
                  yield* Fiber.interruptAll(previous);
                  return;
                }
                watching = yield* Effect.forEach(relays, (relay, index) =>
                  watchRelay(relay, recipients, previous[index]),
                );
              }),
            ),
            Effect.forkScoped,
          );

          const processRaw = ({
            delivery,
            raw,
          }: RawArrival): Option.Option<DeliveredPushWrap> => {
            if (
              typeof raw === "object" &&
              raw !== null &&
              "id" in raw &&
              typeof raw.id === "string" &&
              seenWrapIds.has(raw.id)
            ) {
              return Option.none();
            }

            return Result.match(decodePushWrap(raw), {
              onFailure: (failure) => {
                if (failure !== "missing-push-marker") {
                  options.onInvalidWrap?.(failure);
                }
                return Option.none();
              },
              onSuccess: (wrap) => {
                // Only authenticated wraps emitted live are recorded; a tampered
                // copy must not mark its id as seen.
                if (delivery === "live") {
                  if (seenWrapIds.has(wrap.wrapId)) return Option.none();
                  seenWrapIds.add(wrap.wrapId);
                }
                return Option.some({ delivery, wrap });
              },
            });
          };

          return Stream.fromQueue(rawWraps).pipe(
            Stream.filterMap(Filter.fromPredicateOption(processRaw)),
          );
        });

      return { open } as const;
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make);
}
