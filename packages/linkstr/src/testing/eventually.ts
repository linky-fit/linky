import { expect } from "vitest";
import { Effect } from "effect";

/** `expect.poll` for predicates awaited inside an Effect program. */
export const eventually = (
  predicate: () => boolean,
  timeout = 2000,
): Effect.Effect<void> =>
  Effect.promise(() =>
    expect.poll(predicate, { interval: 5, timeout }).toBe(true),
  );
