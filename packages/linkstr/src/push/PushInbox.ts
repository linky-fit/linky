import {
  Cause,
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
import type { Scope } from "effect";
import type { Filter as NostrFilter } from "nostr-tools";
import { NoReadRelaysConfigured } from "../domain/errors";
import type { RelayUrl } from "../domain/primitives";
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

/**
 * Identity-free kind-1059 watcher for push infrastructure. It owns one honest
 * subscription per relay, reconnects with a fresh rolling lookback, validates
 * outer events, and dedupes authenticated live wraps across relays. Backfill
 * arrivals are re-emitted per copy for the consumer to suppress.
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

          const subscribe = (relay: RelayUrl) =>
            Effect.gen(function* () {
              const lookbackSeconds = Math.floor(
                Duration.toMillis(options.lookback) / 1000,
              );
              const filter: NostrFilter = {
                kinds: [GIFT_WRAP_KIND],
                since: Math.max((yield* nowSeconds) - lookbackSeconds, 0),
              };
              let eoseSeen = false;
              const reportAttemptEnded = (reason: string) =>
                Effect.sync(() =>
                  options.onRelayStatus?.({
                    type: "attempt-ended",
                    relay,
                    reason,
                  }),
                );
              // Relays can drop a long-lived REQ without closing the socket, so
              // periodic refresh is the only way to detect a deaf subscription.
              yield* transport
                .subscribe(
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
                      options.onRelayStatus?.({ type: "eose", relay });
                    },
                  },
                )
                .pipe(
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
            });

          yield* Effect.forEach(relays, (relay) =>
            Effect.forkScoped(
              resubscribeForever(subscribe(relay), resubscribeDelay),
            ),
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
