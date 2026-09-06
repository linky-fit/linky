import { Effect, Schedule } from "effect";
import type { Duration } from "effect";

export interface PollOptions<A> {
  /** Total runs of the poll, the first one immediately. */
  readonly attempts: number;
  readonly interval: Duration.DurationInput;
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
    // `identity` makes the repeat yield the poll's answer instead of the
    // schedule's repetition count.
    schedule: Schedule.identity<A>().pipe(
      Schedule.zipLeft(Schedule.spaced(options.interval)),
      Schedule.zipLeft(Schedule.recurs(options.attempts - 1)),
    ),
    until: options.settled,
  });
