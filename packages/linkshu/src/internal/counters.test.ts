import { Effect, Exit } from "effect";
import { CurrencyUnit, KeysetId, MintUrl } from "../domain/primitives";
import { inMemoryKeyValueStore } from "../ports/inMemoryKeyValueStore";
import { KeyValueStore } from "../ports/KeyValueStore";
import { recordingInspector } from "../testing/inspector";
import {
  advanceCounterTo,
  advanceRestoreCursor,
  deterministicCounterKey,
  readCounter,
  readRestoreCursor,
  restoreCursorKey,
  withCounterLock,
} from "./counters";
import type { CounterScope } from "./counters";

const scope: CounterScope = {
  mint: MintUrl.make("https://mint.example"),
  unit: CurrencyUnit.make("sat"),
  keysetId: KeysetId.make("009a1f293253e41e"),
};

describe("deterministicCounterKey", () => {
  it("is a stable linkshu-prefixed key per mint/unit/keyset", () => {
    expect(deterministicCounterKey(scope)).toBe(
      "linkshu.detCounter.https%3A%2F%2Fmint.example.sat.009a1f293253e41e",
    );
  });
});

describe("restore cursors", () => {
  const run = <A, E>(program: Effect.Effect<A, E, KeyValueStore>) =>
    Effect.runPromiseExit(program.pipe(Effect.provide(inMemoryKeyValueStore)));

  it("keys a cursor by mint, unit, and keyset", () => {
    expect(restoreCursorKey(scope)).toBe(
      "linkshu.restoreCursor.https%3A%2F%2Fmint.example.sat.009a1f293253e41e",
    );
    expect(
      restoreCursorKey({
        ...scope,
        keysetId: KeysetId.make("009a1f293253e41f"),
      }),
    ).not.toBe(restoreCursorKey(scope));
  });

  it("reads an absent or malformed cursor as the start of the tree", async () => {
    const exit = await run(
      Effect.gen(function* () {
        const kv = yield* KeyValueStore;
        const absent = yield* readRestoreCursor(kv, scope);
        yield* kv.set(restoreCursorKey(scope), "not-a-number");
        const malformed = yield* readRestoreCursor(kv, scope);
        yield* kv.set(restoreCursorKey(scope), "-5");
        const negative = yield* readRestoreCursor(kv, scope);
        return { absent, malformed, negative };
      }),
    );

    expect(exit).toEqual(
      Exit.succeed({ absent: 0, malformed: 0, negative: 0 }),
    );
  });

  it("never moves a cursor backwards", async () => {
    const exit = await run(
      Effect.gen(function* () {
        const kv = yield* KeyValueStore;
        const forward = yield* advanceRestoreCursor(kv, scope, 4200);
        const backward = yield* advanceRestoreCursor(kv, scope, 300);
        return {
          forward,
          backward,
          stored: yield* kv.get(restoreCursorKey(scope)),
        };
      }),
    );

    expect(exit).toEqual(
      Exit.succeed({ forward: 4200, backward: 4200, stored: "4200" }),
    );
  });
});

describe("advanceCounterTo", () => {
  it("advances monotonically and never moves backwards", async () => {
    const { events, service: inspector } = recordingInspector();
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const kv = yield* KeyValueStore;
        // Fresh scope reads as 1: slot 0 is cashu-ts's auto-assign sentinel.
        expect(yield* readCounter(kv, scope)).toBe(1);
        expect(yield* advanceCounterTo(kv, inspector, scope, 5, "used")).toBe(
          5,
        );
        // Backwards target is ignored; the stored value wins.
        expect(
          yield* advanceCounterTo(
            kv,
            inspector,
            scope,
            3,
            "collision-recovery",
          ),
        ).toBe(5);
        return yield* readCounter(kv, scope);
      }).pipe(Effect.provide(inMemoryKeyValueStore)),
    );
    expect(exit).toEqual(Exit.succeed(5));
    expect(events).toEqual([
      expect.objectContaining({
        _tag: "CounterAdvanced",
        from: 1,
        to: 5,
        reason: "used",
      }),
    ]);
  });
});

describe("withCounterLock", () => {
  it("maps an unacquirable lease to the public CounterLockTimeout", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const kv = yield* KeyValueStore;
        // Simulate another context holding the counter lock.
        const lockKey =
          "linkshu.detCounterLock.https%3A%2F%2Fmint.example.sat.009a1f293253e41e";
        yield* kv.tryAcquireLease(lockKey, 60_000);
        return yield* withCounterLock(kv, scope, { acquireTimeoutMs: 0 })(
          Effect.succeed("never runs"),
        );
      }).pipe(Effect.provide(inMemoryKeyValueStore)),
    );
    expect(exit).toEqual(
      Exit.fail(
        expect.objectContaining({
          _tag: "CounterLockTimeout",
          mint: scope.mint,
          unit: scope.unit,
          keysetId: scope.keysetId,
        }),
      ),
    );
  });

  it("releases the lock after the effect, even on failure", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const kv = yield* KeyValueStore;
        yield* Effect.flip(
          withCounterLock(kv, scope)(Effect.fail("inner failure")),
        );
        // Re-acquirable immediately: the lease was released on failure.
        return yield* withCounterLock(kv, scope, { acquireTimeoutMs: 0 })(
          Effect.succeed("ran"),
        );
      }).pipe(Effect.provide(inMemoryKeyValueStore)),
    );
    expect(exit).toEqual(Exit.succeed("ran"));
  });
});
