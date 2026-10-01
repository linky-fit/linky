import { Effect, Result } from "effect";
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
  readonly perRelayTimeout?: Duration.Input;
}

/**
 * One-shot fetch fanned out across relays: merge what the reachable relays
 * returned, unvalidated. Fails only when no relay answered at all.
 */
export const fetchRawEvents = (
  transport: NostrTransportService,
  relays: ReadonlyArray<RelayUrl>,
  filter: Filter,
  options?: PlainFetchOptions,
): Effect.Effect<Array<NostrToolsEvent>, AllRelaysUnreachable> =>
  Effect.gen(function* () {
    const perRelayTimeout = options?.perRelayTimeout;
    const fetchOne = (relay: RelayUrl) =>
      perRelayTimeout === undefined
        ? transport.fetch(relay, filter)
        : transport.fetch(relay, filter).pipe(
            Effect.timeoutOrElse({
              duration: perRelayTimeout,
              orElse: () =>
                Effect.fail(
                  new RelayUnreachable({ relay, detail: "fetch timed out" }),
                ),
            }),
          );
    const outcomes = yield* Effect.forEach(
      relays,
      (relay) => Effect.result(fetchOne(relay)),
      { concurrency: "unbounded" },
    );
    const answered = outcomes.filter(Result.isSuccess);
    if (answered.length === 0) {
      return yield* new AllRelaysUnreachable({
        failures: outcomes.filter(Result.isFailure).map(
          ({ failure }) =>
            new RelayRejection({
              relay: failure.relay,
              detail: failure.detail,
            }),
        ),
      });
    }
    return answered.flatMap(({ success }) => success);
  });

/**
 * `fetchRawEvents` narrowed to plain events: malformed or forged events are
 * dropped, newest first so callers pick a winner with `find`.
 */
export const fetchPlainEvents = (
  transport: NostrTransportService,
  relays: ReadonlyArray<RelayUrl>,
  filter: Filter,
  options?: PlainFetchOptions,
): Effect.Effect<Array<SignedPlainEvent>, AllRelaysUnreachable> =>
  fetchRawEvents(transport, relays, filter, options).pipe(
    Effect.map((raws) =>
      raws
        .flatMap((raw) =>
          Result.match(decodeVerifiedPlainEvent(raw), {
            onFailure: () => [],
            onSuccess: (event) => [event],
          }),
        )
        .sort((a, b) => b.created_at - a.created_at),
    ),
  );
