import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import type { Duration } from "effect";

const settlePromises = Effect.promise(
  () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
);

/**
 * Forks `program` and keeps advancing the `TestClock` by `step` — letting
 * pending promises settle first, so a poll reaches its next sleep before the
 * clock moves — until the program finishes. Needs `TestClock.layer()`.
 */
export const runOnTestClock = <A, E, R>(
  program: Effect.Effect<A, E, R>,
  step: Duration.Input,
): Effect.Effect<A, E, R> =>
  Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(program);
    while (fiber.pollUnsafe() === undefined) {
      yield* settlePromises;
      yield* TestClock.adjust(step);
    }
    return yield* Fiber.join(fiber);
  });
