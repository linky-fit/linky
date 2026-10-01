import { Effect, Queue } from "effect";
import type { Cause, Scope } from "effect";

/**
 * A scope-bound queue read through `Stream.fromQueue`: closing the scope
 * discards what is still buffered and ends the stream instead of
 * interrupting its consumer.
 */
export const acquireStreamQueue = <A>(
  make: Effect.Effect<Queue.Queue<A, Cause.Done>>,
): Effect.Effect<Queue.Queue<A, Cause.Done>, never, Scope.Scope> =>
  Effect.acquireRelease(make, (queue) =>
    Effect.andThen(Queue.end(queue), Queue.shutdown(queue)),
  );
