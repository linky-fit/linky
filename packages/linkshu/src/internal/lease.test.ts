import { Deferred, Effect, Exit, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { inMemoryKeyValueStore } from "../ports/inMemoryKeyValueStore";
import type { KeyValueStoreService } from "../ports/KeyValueStore";
import { KeyValueStore } from "../ports/KeyValueStore";
import { withKeyLease } from "./lease";

const withStore = <A, E>(
  program: (kv: KeyValueStoreService) => Effect.Effect<A, E>,
): Effect.Effect<A, E> =>
  Effect.gen(function* () {
    const kv = yield* KeyValueStore;
    return yield* program(kv);
  }).pipe(Effect.provide(inMemoryKeyValueStore));

describe("withKeyLease", () => {
  it("serializes 25 concurrent read-increment-write cycles", async () => {
    const key = "linkshu.test.counter";
    const final = await Effect.runPromise(
      withStore((kv) => {
        const increment = Effect.gen(function* () {
          const current = Number((yield* kv.get(key)) ?? "0");
          yield* Effect.sleep(1);
          yield* kv.set(key, String(current + 1));
        }).pipe(withKeyLease(kv, key));
        return Effect.gen(function* () {
          yield* Effect.all(
            Array.from({ length: 25 }, () => increment),
            { concurrency: "unbounded" },
          );
          return yield* kv.get(key);
        });
      }),
    );
    expect(final).toBe("25");
  });

  it("keeps a second holder out while the first works past the lease's ttl", async () => {
    const { pastTtl, released } = await Effect.runPromise(
      withStore((kv) =>
        Effect.gen(function* () {
          const entered = yield* Deferred.make<void>();
          const finish = yield* Deferred.make<void>();
          const holder = yield* Deferred.succeed(entered, undefined).pipe(
            Effect.andThen(Deferred.await(finish)),
            withKeyLease(kv, "k", { ttlMs: 1_000 }),
            Effect.forkChild,
          );
          yield* Deferred.await(entered);
          yield* TestClock.adjust("1500 millis");
          const pastTtl = yield* kv.tryAcquireLease("k", 1_000);
          yield* Deferred.succeed(finish, undefined);
          yield* Fiber.join(holder);
          const released = yield* kv.tryAcquireLease("k", 1_000);
          return { pastTtl, released };
        }).pipe(Effect.provide(TestClock.layer())),
      ),
    );
    expect(pastTtl).toBeNull();
    expect(released).not.toBeNull();
  });

  it("fails with LeaseLockTimeout when the lock stays held past the acquire deadline", async () => {
    const exit = await Effect.runPromiseExit(
      withStore((kv) =>
        Effect.gen(function* () {
          expect(yield* kv.tryAcquireLease("k", 60_000)).not.toBeNull();
          return yield* Effect.void.pipe(
            withKeyLease(kv, "k", { acquireTimeoutMs: 30, pollMs: 5 }),
          );
        }),
      ),
    );
    expect(exit).toEqual(
      Exit.fail(
        expect.objectContaining({ _tag: "LeaseLockTimeout", key: "k" }),
      ),
    );
  });

  it("releases the lease when the wrapped effect fails", async () => {
    const reclaimed = await Effect.runPromise(
      withStore((kv) =>
        Effect.gen(function* () {
          yield* Effect.fail("boom").pipe(withKeyLease(kv, "k"), Effect.ignore);
          return yield* kv.tryAcquireLease("k", 60_000);
        }),
      ),
    );
    expect(reclaimed).not.toBeNull();
  });
});
