import { Effect, TestClock, TestContext } from "effect";
import { inMemoryKeyValueStore } from "./inMemoryKeyValueStore";
import { KeyValueStore } from "./KeyValueStore";

const run = <A, E>(program: Effect.Effect<A, E, KeyValueStore>): Promise<A> =>
  Effect.runPromise(program.pipe(Effect.provide(inMemoryKeyValueStore)));

describe("inMemoryKeyValueStore", () => {
  it("gets, sets, removes, and lists keys by prefix", async () => {
    const result = await run(
      Effect.gen(function* () {
        const kv = yield* KeyValueStore;
        expect(yield* kv.get("linkshu.a")).toBeNull();
        yield* kv.set("linkshu.a", "1");
        yield* kv.set("linkshu.b", "2");
        yield* kv.set("other.c", "3");
        expect(yield* kv.get("linkshu.a")).toBe("1");
        expect(yield* kv.listKeys("linkshu.")).toEqual([
          "linkshu.a",
          "linkshu.b",
        ]);
        yield* kv.remove("linkshu.a");
        expect(yield* kv.get("linkshu.a")).toBeNull();
        return yield* kv.listKeys("linkshu.");
      }),
    );
    expect(result).toEqual(["linkshu.b"]);
  });

  it("acquires a lease and refuses a second acquire while it is live", async () => {
    await run(
      Effect.gen(function* () {
        const kv = yield* KeyValueStore;
        const lease = yield* kv.tryAcquireLease("k", 60_000);
        expect(lease).not.toBeNull();
        expect(yield* kv.tryAcquireLease("k", 60_000)).toBeNull();
      }),
    );
  });

  it("ignores release with a foreign lease id; the real id still releases", async () => {
    await run(
      Effect.gen(function* () {
        const kv = yield* KeyValueStore;
        const lease = yield* kv.tryAcquireLease("k", 60_000);
        if (lease === null) throw new Error("expected a lease");
        const foreign = yield* kv.tryAcquireLease("other", 60_000);
        if (foreign === null) throw new Error("expected a lease");
        yield* kv.releaseLease("k", foreign);
        expect(yield* kv.tryAcquireLease("k", 60_000)).toBeNull();
        yield* kv.releaseLease("k", lease);
        expect(yield* kv.tryAcquireLease("k", 60_000)).not.toBeNull();
      }),
    );
  });

  it("lets a new acquire claim an expired lease", async () => {
    await run(
      Effect.gen(function* () {
        const kv = yield* KeyValueStore;
        expect(yield* kv.tryAcquireLease("k", 5)).not.toBeNull();
        yield* Effect.sleep(10);
        expect(yield* kv.tryAcquireLease("k", 60_000)).not.toBeNull();
      }),
    );
  });

  it("keeps a renewed lease past its first ttl, and only for its holder", async () => {
    await run(
      Effect.gen(function* () {
        const kv = yield* KeyValueStore;
        const lease = yield* kv.tryAcquireLease("k", 1_000);
        const foreign = yield* kv.tryAcquireLease("other", 1_000);
        if (lease === null || foreign === null) {
          throw new Error("expected a lease");
        }
        yield* TestClock.adjust("800 millis");
        yield* kv.renewLease("k", foreign, 60_000);
        yield* kv.renewLease("k", lease, 1_000);
        yield* TestClock.adjust("800 millis");
        expect(yield* kv.tryAcquireLease("k", 1_000)).toBeNull();
        yield* TestClock.adjust("201 millis");
        expect(yield* kv.tryAcquireLease("k", 1_000)).not.toBeNull();
      }).pipe(Effect.provide(TestContext.TestContext)),
    );
  });
});
