import { expect } from "vitest";
import { Effect } from "effect";

/** `expect.poll` for predicates awaited inside an Effect program. */
export const eventually = (predicate: () => boolean): Effect.Effect<void> =>
  Effect.promise(() =>
    expect.poll(predicate, { interval: 5, timeout: 2000 }).toBe(true),
  );
