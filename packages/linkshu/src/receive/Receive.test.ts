import type { Proof } from "@cashu/cashu-ts";
import { getEncodedToken, MintOperationError } from "@cashu/cashu-ts";
import { Effect, Exit, Layer } from "effect";
import { CurrencyUnit, KeysetId, MintUrl } from "../domain/primitives";
import { deterministicCounterKey } from "../internal/counters";
import { WalletInstances } from "../mint/internal/WalletInstances";
import type { LoadedWallet } from "../mint/internal/WalletInstances";
import { inMemoryKeyValueStore } from "../ports/inMemoryKeyValueStore";
import { inMemoryTokenStore } from "../ports/inMemoryTokenStore";
import { KeyValueStore } from "../ports/KeyValueStore";
import { TokenStore } from "../ports/TokenStore";
import { fakeWallet, KEYSET_HEX, proof } from "../testing/fakeWallet";
import { recordingInspector } from "../testing/inspector";
import { parseTokenText } from "../token/codec";
import { ReceiveDraft } from "./domain";
import { Receive } from "./Receive";

const mint = MintUrl.make("https://mint.example");
const counterKey = deterministicCounterKey({
  mint,
  unit: CurrencyUnit.make("sat"),
  keysetId: KeysetId.make(KEYSET_HEX),
});

// 6 sats in; the "mint" hands back 5 (its input fee).
const sourceToken = getEncodedToken({
  mint,
  unit: "sat",
  proofs: [proof(4, "src-a"), proof(2, "src-b")],
});
const receivedProofs = [proof(4, "rcv-a"), proof(1, "rcv-b")];

const outputsAlreadySigned = () =>
  new MintOperationError(11005, "outputs have already been signed before");

interface FakeWalletArgs {
  keysetId?: string;
  receive: (counter: number) => Promise<Proof[]>;
  restore?: () => Promise<{
    proofs: Proof[];
    lastCounterWithSignature?: number;
  }>;
}

const makeWallet = (args: FakeWalletArgs) => {
  const receiveCounters: number[] = [];
  const restoreCalls: Array<{ start: number; count: number }> = [];
  const wallet = fakeWallet({
    keysetId: args.keysetId ?? KEYSET_HEX,
    receive: (_token, _config, outputType) => {
      const counter =
        outputType?.type === "deterministic" ? outputType.counter : -1;
      receiveCounters.push(counter);
      return args.receive(counter);
    },
    restore: (start, count) => {
      restoreCalls.push({ start, count });
      return args.restore
        ? args.restore()
        : Promise.reject(new Error("restore unavailable"));
    },
  });
  return { wallet, receiveCounters, restoreCalls };
};

const makeHarness = (wallet: LoadedWallet) => {
  const inspector = recordingInspector();
  const layer = Receive.DefaultWithoutDependencies.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        Layer.succeed(
          WalletInstances,
          WalletInstances.make({ get: () => Effect.succeed(wallet) }),
        ),
        inMemoryKeyValueStore,
        inMemoryTokenStore,
        inspector.layer,
      ),
    ),
  );
  const run = <A, E>(
    program: Effect.Effect<
      A,
      E,
      Receive | TokenStore | KeyValueStore | WalletInstances
    >,
  ) => Effect.runPromiseExit(program.pipe(Effect.provide(layer)));
  return { run, events: inspector.events };
};

const receiveAndInspect = (text: string) =>
  Effect.gen(function* () {
    const receive = yield* Receive;
    const kv = yield* KeyValueStore;
    const tokenStore = yield* TokenStore;
    const receipt = yield* Effect.either(
      receive.receive(new ReceiveDraft({ text })),
    );
    return {
      receipt,
      rows: yield* tokenStore.loadAll,
      counter: yield* kv.get(counterKey),
    };
  });

describe("Receive.receive", () => {
  it("swaps deterministically, stores an accepted row, and advances the counter", async () => {
    const { wallet, receiveCounters } = makeWallet({
      receive: () => Promise.resolve(receivedProofs),
    });
    const { run, events } = makeHarness(wallet);

    const exit = await run(receiveAndInspect(sourceToken));
    assert(Exit.isSuccess(exit));
    const { receipt, rows, counter } = exit.value;

    assert(receipt._tag === "Right");
    expect(receipt.right.mint).toBe(mint);
    expect(receipt.right.unit).toBe("sat");
    expect(receipt.right.amount).toBe(5);

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.state).toBe("accepted");
    expect(row.error).toBeNull();
    expect(row.originalTokenText).toBe(sourceToken);
    expect(row.tokenText).toBe(receipt.right.tokenText);
    expect(row.tokenText).not.toBe(sourceToken);
    expect(parseTokenText(row.tokenText)?.amount).toBe(5);
    expect(receipt.right.rowId).toBe(row.id);

    expect(receiveCounters).toEqual([1]);
    expect(counter).toBe("3");

    expect(events.map((event) => event._tag)).toEqual([
      "TokenLifecycleChanged",
      "CounterAdvanced",
      "TokenLifecycleChanged",
      "OperationSucceeded",
    ]);
    expect(events[0]).toMatchObject({ from: null, to: "pending" });
    expect(events[1]).toMatchObject({ from: 1, to: 3, reason: "used" });
    expect(events[2]).toMatchObject({ from: "pending", to: "accepted" });
    expect(events[3]).toMatchObject({
      name: "receive.receive",
      params: {},
      result: { rowId: row.id, mint, unit: "sat", amount: 5 },
    });
    // No key material: neither token text nor proof secrets in any event.
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain("cashu");
    expect(serialized).not.toContain("rcv-a");
    expect(serialized).not.toContain("src-a");
  });

  it("extracts the token from surrounding scanned text", async () => {
    const { wallet } = makeWallet({
      receive: () => Promise.resolve(receivedProofs),
    });
    const { run } = makeHarness(wallet);

    const exit = await run(
      receiveAndInspect(`here you go: cashu:${sourceToken} enjoy!`),
    );
    assert(Exit.isSuccess(exit));
    expect(exit.value.receipt._tag).toBe("Right");
    expect(exit.value.rows[0]?.originalTokenText).toBe(sourceToken);
  });

  it("fails with TokenParseFailed and stores nothing for token-less text", async () => {
    const { wallet, receiveCounters } = makeWallet({
      receive: () => Promise.reject(new Error("must not be called")),
    });
    const { run } = makeHarness(wallet);

    const exit = await run(
      Effect.gen(function* () {
        const receive = yield* Receive;
        const tokenStore = yield* TokenStore;
        const empty = yield* Effect.flip(
          receive.receive(new ReceiveDraft({ text: "   " })),
        );
        const noToken = yield* Effect.flip(
          receive.receive(new ReceiveDraft({ text: "hello world" })),
        );
        return { empty, noToken, rows: yield* tokenStore.loadAll };
      }),
    );
    assert(Exit.isSuccess(exit));
    expect(exit.value.empty).toMatchObject({
      _tag: "TokenParseFailed",
      reason: "empty",
    });
    expect(exit.value.noToken).toMatchObject({
      _tag: "TokenParseFailed",
      reason: "no-token-found",
    });
    expect(exit.value.rows).toEqual([]);
    expect(receiveCounters).toEqual([]);
  });

  it("dedupes a second receive of the same token text", async () => {
    const { wallet, receiveCounters } = makeWallet({
      receive: () => Promise.resolve(receivedProofs),
    });
    const { run } = makeHarness(wallet);

    const exit = await run(
      Effect.gen(function* () {
        const receive = yield* Receive;
        const tokenStore = yield* TokenStore;
        const first = yield* receive.receive(
          new ReceiveDraft({ text: sourceToken }),
        );
        const second = yield* Effect.flip(
          receive.receive(new ReceiveDraft({ text: sourceToken })),
        );
        return { first, second, rows: yield* tokenStore.loadAll };
      }),
    );
    assert(Exit.isSuccess(exit));
    expect(exit.value.second).toMatchObject({
      _tag: "TokenAlreadyKnown",
      rowId: exit.value.first.rowId,
    });
    expect(exit.value.rows).toHaveLength(1);
    expect(receiveCounters).toEqual([1]);
  });

  it("dedupes against a row's re-signed encoding", async () => {
    const { wallet } = makeWallet({
      receive: () => Promise.resolve(receivedProofs),
    });
    const { run } = makeHarness(wallet);

    const exit = await run(
      Effect.gen(function* () {
        const receive = yield* Receive;
        const first = yield* receive.receive(
          new ReceiveDraft({ text: sourceToken }),
        );
        const second = yield* Effect.flip(
          receive.receive(new ReceiveDraft({ text: first.tokenText })),
        );
        return { first, second };
      }),
    );
    assert(Exit.isSuccess(exit));
    expect(exit.value.second).toMatchObject({
      _tag: "TokenAlreadyKnown",
      rowId: exit.value.first.rowId,
    });
  });

  it("keeps no row behind on transient mint failure", async () => {
    const { wallet } = makeWallet({
      receive: () => Promise.reject(new TypeError("fetch failed")),
    });
    const { run, events } = makeHarness(wallet);

    const exit = await run(receiveAndInspect(sourceToken));
    assert(Exit.isSuccess(exit));
    assert(exit.value.receipt._tag === "Left");
    expect(exit.value.receipt.left._tag).toBe("MintUnreachable");
    expect(exit.value.rows).toEqual([]);
    expect(events.map((event) => event._tag)).toEqual([
      "TokenLifecycleChanged",
      "OperationFailed",
    ]);
  });

  it("persists a serialized error row on definitive rejection", async () => {
    const { wallet } = makeWallet({
      receive: () =>
        Promise.reject(new MintOperationError(20003, "keyset inactive")),
    });
    const { run } = makeHarness(wallet);

    const exit = await run(receiveAndInspect(sourceToken));
    assert(Exit.isSuccess(exit));
    assert(exit.value.receipt._tag === "Left");
    expect(exit.value.receipt.left).toMatchObject({
      _tag: "MintRejected",
      code: 20003,
    });
    expect(exit.value.rows).toHaveLength(1);
    const row = exit.value.rows[0];
    expect(row.state).toBe("error");
    expect(row.tokenText).toBe(sourceToken);
    expect(row.error).not.toBeNull();
    expect(JSON.parse(row.error ?? "")).toMatchObject({
      _tag: "MintRejected",
      code: 20003,
    });
  });

  it("classifies spent inputs as TokenAlreadySpent and persists the error", async () => {
    const { wallet } = makeWallet({
      receive: () =>
        Promise.reject(new MintOperationError(11001, "Token already spent.")),
    });
    const { run } = makeHarness(wallet);

    const exit = await run(receiveAndInspect(sourceToken));
    assert(Exit.isSuccess(exit));
    assert(exit.value.receipt._tag === "Left");
    expect(exit.value.receipt.left).toMatchObject({
      _tag: "TokenAlreadySpent",
      mint,
    });
    expect(exit.value.rows[0]?.state).toBe("error");
    expect(JSON.parse(exit.value.rows[0]?.error ?? "")).toMatchObject({
      _tag: "TokenAlreadySpent",
    });
  });

  it("recovers a stale counter via NUT-09 restore", async () => {
    const { wallet, receiveCounters, restoreCalls } = makeWallet({
      receive: (counter) =>
        counter < 40
          ? Promise.reject(outputsAlreadySigned())
          : Promise.resolve(receivedProofs),
      restore: () =>
        Promise.resolve({ proofs: [], lastCounterWithSignature: 39 }),
    });
    const { run, events } = makeHarness(wallet);

    const exit = await run(receiveAndInspect(sourceToken));
    assert(Exit.isSuccess(exit));
    expect(exit.value.receipt._tag).toBe("Right");
    expect(receiveCounters).toEqual([1, 40]);
    expect(restoreCalls).toEqual([{ start: 1, count: 100 }]);
    expect(exit.value.counter).toBe("42");

    const counterEvents = events.filter(
      (event) => event._tag === "CounterAdvanced",
    );
    expect(counterEvents).toEqual([
      expect.objectContaining({
        from: 1,
        to: 40,
        reason: "collision-recovery",
      }),
      expect.objectContaining({ from: 40, to: 42, reason: "used" }),
    ]);
  });

  it("falls back to a fixed bump when restore cannot locate the collision", async () => {
    const { wallet, receiveCounters, restoreCalls } = makeWallet({
      receive: (counter) =>
        counter < 64
          ? Promise.reject(outputsAlreadySigned())
          : Promise.resolve(receivedProofs),
      restore: () => Promise.reject(new Error("restore failed")),
    });
    const { run } = makeHarness(wallet);

    const exit = await run(receiveAndInspect(sourceToken));
    assert(Exit.isSuccess(exit));
    expect(exit.value.receipt._tag).toBe("Right");
    expect(receiveCounters).toEqual([1, 65]);
    expect(restoreCalls).toHaveLength(1);
    expect(exit.value.counter).toBe("67");
  });

  it("bumps without probing restore for outputs-pending collisions", async () => {
    const { wallet, receiveCounters, restoreCalls } = makeWallet({
      receive: (counter) =>
        counter === 1
          ? Promise.reject(new MintOperationError(11004, "outputs are pending"))
          : Promise.resolve(receivedProofs),
    });
    const { run } = makeHarness(wallet);

    const exit = await run(receiveAndInspect(sourceToken));
    assert(Exit.isSuccess(exit));
    expect(exit.value.receipt._tag).toBe("Right");
    expect(receiveCounters).toEqual([1, 65]);
    expect(restoreCalls).toEqual([]);
  });

  it("starts the swap from the persisted counter", async () => {
    const { wallet, receiveCounters } = makeWallet({
      receive: () => Promise.resolve(receivedProofs),
    });
    const { run } = makeHarness(wallet);

    const exit = await run(
      Effect.gen(function* () {
        const kv = yield* KeyValueStore;
        yield* kv.set(counterKey, "7");
        const receive = yield* Receive;
        yield* receive.receive(new ReceiveDraft({ text: sourceToken }));
        return yield* kv.get(counterKey);
      }),
    );
    expect(exit).toEqual(Exit.succeed("9"));
    expect(receiveCounters).toEqual([7]);
  });

  it("gives up after repeated collisions with a definitive rejection", async () => {
    const { wallet, receiveCounters } = makeWallet({
      receive: () => Promise.reject(outputsAlreadySigned()),
      restore: () => Promise.resolve({ proofs: [] }),
    });
    const { run } = makeHarness(wallet);

    const exit = await run(receiveAndInspect(sourceToken));
    assert(Exit.isSuccess(exit));
    assert(exit.value.receipt._tag === "Left");
    expect(exit.value.receipt.left._tag).toBe("MintRejected");
    expect(receiveCounters).toHaveLength(5);
    expect(exit.value.rows[0]?.state).toBe("error");
  });
});
