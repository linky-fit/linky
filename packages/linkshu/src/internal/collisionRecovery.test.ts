import { Effect, Exit } from "effect";
import { MintOperationError } from "@cashu/cashu-ts";
import { CurrencyUnit, KeysetId, MintUrl } from "../domain/primitives";
import { inMemoryKeyValueStore } from "../ports/inMemoryKeyValueStore";
import { KeyValueStore } from "../ports/KeyValueStore";
import type { KeyValueStoreService } from "../ports/KeyValueStore";
import { fakeWallet } from "../testing/fakeWallet";
import { recordingInspector } from "../testing/inspector";
import { recoverFromCollision } from "./collisionRecovery";
import {
  advanceCounterTo,
  advanceRestoreCursor,
  readCounter,
} from "./counters";
import type { CounterScope } from "./counters";

const scope: CounterScope = {
  mint: MintUrl.make("https://mint.example"),
  unit: CurrencyUnit.make("sat"),
  keysetId: KeysetId.make("009a1f293253e41e"),
};

const alreadySigned = new MintOperationError(
  11003,
  "outputs have already been signed before",
);

const outputsPending = new MintOperationError(11004, "outputs are pending");

interface HarnessArgs {
  readonly lastCounterWithSignature?: number;
  readonly restoreFails?: boolean;
}

interface State {
  readonly cursor?: number;
  readonly stored?: number;
}

const makeHarness = (args: HarnessArgs = {}) => {
  const restoreCalls: Array<{ start: number; count: number }> = [];
  const { events, service: inspector } = recordingInspector();
  const wallet = fakeWallet({
    restore: (start, count) => {
      restoreCalls.push({ start, count });
      if (args.restoreFails === true) {
        return Promise.reject(new Error("restore unavailable"));
      }
      return Promise.resolve({
        proofs: [],
        ...(args.lastCounterWithSignature === undefined
          ? {}
          : { lastCounterWithSignature: args.lastCounterWithSignature }),
      });
    },
  });

  const recover = (kv: KeyValueStoreService, counter: number, raw: unknown) =>
    recoverFromCollision(
      { kv, inspector, wallet, scope, fallbackBump: 128 },
      counter,
      raw,
    );

  const run = (
    counter: number,
    state: State = {},
    raw: unknown = alreadySigned,
  ) =>
    Effect.runPromiseExit(
      Effect.gen(function* () {
        const kv = yield* KeyValueStore;
        if (state.cursor !== undefined) {
          yield* advanceRestoreCursor(kv, scope, state.cursor);
        }
        if (state.stored !== undefined) {
          yield* advanceCounterTo(kv, inspector, scope, state.stored, "used");
        }
        events.length = 0;
        const recovered = yield* recover(kv, counter, raw);
        return { recovered, stored: yield* readCounter(kv, scope) };
      }).pipe(Effect.provide(inMemoryKeyValueStore)),
    );

  return { run, recover, restoreCalls, events };
};

describe("recoverFromCollision", () => {
  it("jumps to the restore cursor when it is past the colliding counter", async () => {
    const { run, restoreCalls, events } = makeHarness({
      lastCounterWithSignature: 6172,
    });

    const exit = await run(6096, { cursor: 6841 });

    assert(Exit.isSuccess(exit));
    expect(exit.value.recovered).toBe(6841);
    expect(exit.value.stored).toBe(6841);
    expect(restoreCalls).toEqual([]);
    expect(events).toEqual([
      expect.objectContaining({
        _tag: "CounterAdvanced",
        from: 1,
        to: 6841,
        reason: "collision-recovery",
      }),
    ]);
  });

  it("jumps to the cursor for a pending-outputs collision too", async () => {
    const { run, restoreCalls } = makeHarness();

    const exit = await run(6096, { cursor: 6841 }, outputsPending);

    assert(Exit.isSuccess(exit));
    expect(exit.value.recovered).toBe(6841);
    expect(restoreCalls).toEqual([]);
  });

  it("probes the window when the cursor is behind the colliding counter", async () => {
    const { run, restoreCalls } = makeHarness({
      lastCounterWithSignature: 6172,
    });

    const exit = await run(6096, { cursor: 500 });

    assert(Exit.isSuccess(exit));
    expect(exit.value.recovered).toBe(6173);
    expect(restoreCalls).toEqual([{ start: 6096, count: 100 }]);
  });

  it("probes the window when the cursor equals the colliding counter", async () => {
    const { run, restoreCalls } = makeHarness({
      lastCounterWithSignature: 6172,
    });

    const exit = await run(6096, { cursor: 6096 });

    assert(Exit.isSuccess(exit));
    expect(exit.value.recovered).toBe(6173);
    expect(restoreCalls).toEqual([{ start: 6096, count: 100 }]);
  });

  it("probes when the cursor is inside the block the caller already reserved", async () => {
    const { run, restoreCalls } = makeHarness({
      lastCounterWithSignature: 6172,
    });

    const exit = await run(6096, { cursor: 6100, stored: 6160 });

    assert(Exit.isSuccess(exit));
    expect(exit.value.recovered).toBe(6173);
    expect(exit.value.stored).toBe(6173);
    expect(restoreCalls).toEqual([{ start: 6096, count: 100 }]);
  });

  it("probes from the cursor when the jump collides again", async () => {
    const { recover, restoreCalls } = makeHarness({
      lastCounterWithSignature: 6900,
    });

    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const kv = yield* KeyValueStore;
        yield* advanceRestoreCursor(kv, scope, 6841);
        const first = yield* recover(kv, 6096, alreadySigned);
        const second = yield* recover(kv, first, alreadySigned);
        return { first, second };
      }).pipe(Effect.provide(inMemoryKeyValueStore)),
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value).toEqual({ first: 6841, second: 6901 });
    expect(restoreCalls).toEqual([{ start: 6841, count: 100 }]);
  });

  it("falls back to the blind bump when neither cursor nor probe helps", async () => {
    const { run, restoreCalls } = makeHarness({ restoreFails: true });

    const exit = await run(6096);

    assert(Exit.isSuccess(exit));
    expect(exit.value.recovered).toBe(6224);
    expect(restoreCalls).toHaveLength(1);
  });

  it("never lowers the stored counter on a stale probe answer", async () => {
    const { run } = makeHarness({ lastCounterWithSignature: 10 });

    const exit = await run(6096, { cursor: 20, stored: 6096 });

    assert(Exit.isSuccess(exit));
    expect(exit.value.recovered).toBe(6096);
    expect(exit.value.stored).toBe(6096);
  });
});
