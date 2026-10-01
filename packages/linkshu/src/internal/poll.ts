import { Effect, Schedule } from "effect";
import type { Duration } from "effect";

export interface PollOptions<A> {
  /** Total runs of the poll, the first one immediately. */
  readonly attempts: number;
  readonly interval: Duration.Input;
  readonly settled: (value: A) => boolean;
}

/**
 * Bounded poll: the first answer `settled` accepts, or the last answer once
 * the attempts are used up.
 */
export const pollUntil = <A, E, R>(
  poll: Effect.Effect<A, E, R>,
  options: PollOptions<A>,
): Effect.Effect<A, E, R> =>
  Effect.repeat(poll, {
    schedule: Schedule.spaced(options.interval),
    times: options.attempts - 1,
    until: options.settled,
  });
