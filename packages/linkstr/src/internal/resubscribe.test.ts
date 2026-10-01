import { Clock, Duration, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vitest";
import { resubscribeForever } from "./resubscribe";

const runWithTestClock = <A>(effect: Effect.Effect<A>): Promise<A> =>
  Effect.runPromise(Effect.provide(effect, TestClock.layer()));

const attemptGaps = (startedAt: ReadonlyArray<number>): Array<number> =>
  startedAt.slice(1).map((at, index) => at - (startedAt[index] ?? 0));

describe("resubscribeForever", () => {
  it("backs off exponentially while attempts keep failing fast", async () => {
    await runWithTestClock(
      Effect.gen(function* () {
        const startedAt: Array<number> = [];
        const failingAttempt = Effect.gen(function* () {
          startedAt.push(yield* Clock.currentTimeMillis);
          return yield* Effect.fail("unreachable");
        });
        const fiber = yield* Effect.forkChild(
          resubscribeForever(failingAttempt, Duration.millis(100)),
        );
        yield* TestClock.adjust(Duration.seconds(10));
        yield* Fiber.interrupt(fiber);

        // Delays double from 100ms (±20% jitter) and cap at 1200ms; a fixed
        // 100ms cadence would produce ~100 attempts in 10s.
        expect(startedAt.length).toBeGreaterThanOrEqual(5);
        expect(startedAt.length).toBeLessThanOrEqual(20);
        const gaps = attemptGaps(startedAt);
        expect(gaps[0]).toBeLessThanOrEqual(120);
        expect(Math.max(...gaps)).toBeGreaterThanOrEqual(800);
        expect(Math.max(...gaps)).toBeLessThanOrEqual(1200 * 1.2);
      }),
    );
  });

  it("resets the backoff after a long-lived attempt", async () => {
    await runWithTestClock(
      Effect.gen(function* () {
        const startedAt: Array<number> = [];
        const healthyUptime = Duration.millis(100 * 6);
        const longLivedAttempt = Effect.gen(function* () {
          startedAt.push(yield* Clock.currentTimeMillis);
          yield* Effect.sleep(healthyUptime);
        });
        const fiber = yield* Effect.forkChild(
          resubscribeForever(longLivedAttempt, Duration.millis(100)),
        );
        yield* TestClock.adjust(Duration.seconds(10));
        yield* Fiber.interrupt(fiber);

        // Every attempt survives past the healthy-uptime threshold, so each
        // gap stays uptime + base delay (±20% jitter) — no growth.
        const gaps = attemptGaps(startedAt);
        expect(gaps.length).toBeGreaterThanOrEqual(5);
        for (const gap of gaps) {
          expect(gap).toBeGreaterThanOrEqual(600 + 80);
          expect(gap).toBeLessThanOrEqual(600 + 120);
        }
      }),
    );
  });
});
