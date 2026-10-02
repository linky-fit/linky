import { Effect, Either } from "effect";
import type { Duration } from "effect";
import type { Filter } from "nostr-tools";
import type { Event as NostrToolsEvent } from "nostr-tools";
import { RelayRejection } from "../domain/delivery";
import { AllRelaysUnreachable } from "../domain/errors";
import type { RelayUrl } from "../domain/primitives";
import { RelayUnreachable } from "../services/NostrTransport";
import type { NostrTransportService } from "../services/NostrTransport";
import type { SignedPlainEvent } from "./nostrEvent";
import { decodeVerifiedPlainEvent } from "./plainEvent";

export interface PlainFetchOptions {
  /**
   * Bounds each relay's fetch; a relay that exceeds it counts as unanswered.
   * The transport's own worst case is the connection timeout plus the EOSE
   * timeout (~11s), so this trims the reachable-but-silent tail.
   */
  readonly perRelayTimeout?: Duration.DurationInput;
}

export interface RawAnswers {
  readonly events: Array<NostrToolsEvent>;
  /** The relays that did not answer. */
  readonly failures: Array<RelayRejection>;
}

/**
 * One-shot fetch fanned out across relays: what the reachable relays
 * returned, unvalidated, and which relays did not answer. Fails only when no
 * relay answered at all.
 */
export const fetchRawEvents = (
  transport: NostrTransportService,
  relays: ReadonlyArray<RelayUrl>,
  filter: Filter,
  options?: PlainFetchOptions,
): Effect.Effect<RawAnswers, AllRelaysUnreachable> =>
  Effect.gen(function* () {
    const perRelayTimeout = options?.perRelayTimeout;
    const fetchOne = (relay: RelayUrl) =>
      perRelayTimeout === undefined
        ? transport.fetch(relay, filter)
        : transport.fetch(relay, filter).pipe(
            Effect.timeoutFail({
              duration: perRelayTimeout,
              onTimeout: () =>
                new RelayUnreachable({ relay, detail: "fetch timed out" }),
            }),
          );
    const outcomes = yield* Effect.forEach(
      relays,
      (relay) => Effect.either(fetchOne(relay)),
      { concurrency: "unbounded" },
    );
    const failures = outcomes
      .filter(Either.isLeft)
      .map(
        ({ left }) =>
          new RelayRejection({ relay: left.relay, detail: left.detail }),
      );
    const answered = outcomes.filter(Either.isRight);
    if (answered.length === 0)
      return yield* new AllRelaysUnreachable({ failures });
    return { events: answered.flatMap(({ right }) => right), failures };
  });

/** Malformed or forged events dropped, newest first so callers pick a winner with `find`. */
export const toPlainEvents = (
  raws: ReadonlyArray<NostrToolsEvent>,
): Array<SignedPlainEvent> =>
  raws
    .flatMap((raw) =>
      Either.match(decodeVerifiedPlainEvent(raw), {
        onLeft: () => [],
        onRight: (event) => [event],
      }),
    )
    .sort((a, b) => b.created_at - a.created_at);

/** `fetchRawEvents` narrowed to plain events. */
export const fetchPlainEvents = (
  transport: NostrTransportService,
  relays: ReadonlyArray<RelayUrl>,
  filter: Filter,
  options?: PlainFetchOptions,
): Effect.Effect<Array<SignedPlainEvent>, AllRelaysUnreachable> =>
  Effect.map(fetchRawEvents(transport, relays, filter, options), ({ events }) =>
    toPlainEvents(events),
  );
