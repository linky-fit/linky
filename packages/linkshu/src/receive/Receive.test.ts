import type { Proof } from "@cashu/cashu-ts";
import { getEncodedToken, MintOperationError } from "@cashu/cashu-ts";
import { Effect, Exit, Layer } from "effect";
import {
  CurrencyUnit,
  KeysetId,
  MintUrl,
  TokenText,
} from "../domain/primitives";
import { deterministicCounterKey } from "../internal/counters";
import { WalletInstances } from "../mint/internal/WalletInstances";
import type { LoadedWallet } from "../mint/internal/WalletInstances";
import { inMemoryKeyValueStore } from "../ports/inMemoryKeyValueStore";
import { inMemoryOperationStore } from "../ports/inMemoryOperationStore";
import { inMemoryProofStore } from "../ports/inMemoryProofStore";
import { KeyValueStore } from "../ports/KeyValueStore";
import { OperationStore } from "../ports/OperationStore";
import { ProofStore } from "../ports/ProofStore";
import { fakeWallet, KEYSET_HEX, proof } from "../testing/fakeWallet";
import { recordingInspector } from "../testing/inspector";
import { secretsOf, seedProofs, seedTransfer } from "../testing/inventory";
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
const sourceProofs = [proof(4, "src-a"), proof(2, "src-b")];
const sourceToken = TokenText.make(
  getEncodedToken({ mint, unit: "sat", proofs: sourceProofs }),
);
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
        inMemoryProofStore,
        inMemoryOperationStore,
        inspector.layer,
      ),
    ),
  );
  const run = <A, E>(
    program: Effect.Effect<
      A,
      E,
      Receive | ProofStore | OperationStore | KeyValueStore | WalletInstances
    >,
  ) => Effect.runPromiseExit(program.pipe(Effect.provide(layer)));
  return { run, events: inspector.events };
};

const inventory = Effect.gen(function* () {
  return {
    proofs: yield* (yield* ProofStore).loadAll,
    operations: yield* (yield* OperationStore).loadAll,
  };
});

const receiveText = (text: string) =>
  Effect.flatMap(Receive, (receive) =>
    receive.receive(new ReceiveDraft({ text })),
  );

const receiveAndInspect = (text: string) =>
  Effect.gen(function* () {
    const kv = yield* KeyValueStore;
    const receipt = yield* Effect.either(receiveText(text));
    return {
      receipt,
      ...(yield* inventory),
      counter: yield* kv.get(counterKey),
    };
  });

describe("Receive.receive", () => {
  it("swaps deterministically, stores the proofs as balance, and closes the receive", async () => {
    const { wallet, receiveCounters } = makeWallet({
      receive: () => Promise.resolve(receivedProofs),
    });
    const { run, events } = makeHarness(wallet);

    const exit = await run(receiveAndInspect(sourceToken));
    assert(Exit.isSuccess(exit));
    const { receipt, proofs, operations, counter } = exit.value;

    assert(receipt._tag === "Right");
    expect(receipt.right.mint).toBe(mint);
    expect(receipt.right.unit).toBe("sat");
    expect(receipt.right.amount).toBe(5);
    expect(receipt.right.tokenText).not.toBe(sourceToken);
    expect(parseTokenText(receipt.right.tokenText)?.amount).toBe(5);

    expect(operations).toHaveLength(1);
    const transfer = operations[0];
    expect(transfer).toMatchObject({
      kind: "receive",
      status: "done",
      mint,
      unit: "sat",
      amount: 6,
      tokenText: sourceToken,
      error: null,
    });
    expect(receipt.right.operationId).toBe(transfer?.id);

    // The fresh proofs are balance owned by nobody: the receive is closed.
    expect(secretsOf(proofs)).toEqual(["rcv-a", "rcv-b"]);
    expect(proofs.every((p) => p.state === "available")).toBe(true);
    expect(proofs.every((p) => p.operationId === null)).toBe(true);

    expect(receiveCounters).toEqual([1]);
    expect(counter).toBe("3");

    expect(events.map((event) => event._tag)).toEqual([
      "OperationChanged",
      "CounterAdvanced",
      "ProofsChanged",
      "OperationChanged",
      "OperationSucceeded",
    ]);
    expect(events[0]).toMatchObject({
      kind: "receive",
      from: null,
      to: "pending",
      reason: "receive",
    });
    expect(events[1]).toMatchObject({ from: 1, to: 3, reason: "used" });
    expect(events[2]).toMatchObject({
      mint,
      from: null,
      to: "available",
      count: 2,
      amount: 5,
      operationId: null,
      reason: "receive",
    });
    expect(events[3]).toMatchObject({
      from: "pending",
      to: "done",
      reason: "receive",
    });
    expect(events[4]).toMatchObject({
      name: "receive.receive",
      params: {},
      result: { operationId: transfer?.id, mint, unit: "sat", amount: 5 },
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
    expect(exit.value.operations[0]?.tokenText).toBe(sourceToken);
  });

  it("fails with TokenParseFailed and stores nothing for token-less text", async () => {
    const { wallet, receiveCounters } = makeWallet({
      receive: () => Promise.reject(new Error("must not be called")),
    });
    const { run } = makeHarness(wallet);

    const exit = await run(
      Effect.gen(function* () {
        const empty = yield* Effect.flip(receiveText("   "));
        const noToken = yield* Effect.flip(receiveText("hello world"));
        return { empty, noToken, ...(yield* inventory) };
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
    expect(exit.value.proofs).toEqual([]);
    expect(exit.value.operations).toEqual([]);
    expect(receiveCounters).toEqual([]);
  });

  it("dedupes a second receive of the same token text", async () => {
    const { wallet, receiveCounters } = makeWallet({
      receive: () => Promise.resolve(receivedProofs),
    });
    const { run } = makeHarness(wallet);

    const exit = await run(
      Effect.gen(function* () {
        const first = yield* receiveText(sourceToken);
        const second = yield* Effect.flip(receiveText(sourceToken));
        return { first, second, ...(yield* inventory) };
      }),
    );
    assert(Exit.isSuccess(exit));
    expect(exit.value.second).toMatchObject({
      _tag: "TokenAlreadyKnown",
      operationId: exit.value.first.operationId,
    });
    expect(exit.value.operations).toHaveLength(1);
    expect(exit.value.proofs).toHaveLength(2);
    expect(receiveCounters).toEqual([1]);
  });

  it("dedupes the re-signed encoding by its stored proofs, which no transfer names", async () => {
    const { wallet, receiveCounters } = makeWallet({
      receive: () => Promise.resolve(receivedProofs),
    });
    const { run } = makeHarness(wallet);

    const exit = await run(
      Effect.gen(function* () {
        const first = yield* receiveText(sourceToken);
        const second = yield* Effect.flip(receiveText(first.tokenText));
        return { second, ...(yield* inventory) };
      }),
    );
    assert(Exit.isSuccess(exit));
    expect(exit.value.second).toMatchObject({
      _tag: "TokenAlreadyKnown",
      operationId: null,
    });
    expect(exit.value.operations).toHaveLength(1);
    expect(receiveCounters).toEqual([1]);
  });

  it("dedupes a token whose proofs a send handed out, naming that send", async () => {
    const { wallet, receiveCounters } = makeWallet({
      receive: () => Promise.resolve(receivedProofs),
    });
    const { run } = makeHarness(wallet);
    const otherText = TokenText.make(
      getEncodedToken({ mint, unit: "sat", proofs: [proof(6, "elsewhere")] }),
    );

    const exit = await run(
      Effect.gen(function* () {
        const send = yield* seedTransfer("send", "issued", mint, otherText, 6);
        yield* seedProofs(mint, [sourceProofs[0]], "handedOut", send.id);
        const result = yield* Effect.flip(receiveText(sourceToken));
        return { send, result, ...(yield* inventory) };
      }),
    );
    assert(Exit.isSuccess(exit));
    expect(exit.value.result).toMatchObject({
      _tag: "TokenAlreadyKnown",
      operationId: exit.value.send.id,
    });
    expect(exit.value.operations).toHaveLength(1);
    expect(exit.value.proofs).toHaveLength(1);
    expect(receiveCounters).toEqual([]);
  });

  it("fails the receive with the serialized error on transient mint failure", async () => {
    const { wallet } = makeWallet({
      receive: () => Promise.reject(new TypeError("fetch failed")),
    });
    const { run, events } = makeHarness(wallet);

    const exit = await run(receiveAndInspect(sourceToken));
    assert(Exit.isSuccess(exit));
    assert(exit.value.receipt._tag === "Left");
    expect(exit.value.receipt.left._tag).toBe("MintUnreachable");
    expect(exit.value.proofs).toEqual([]);
    expect(exit.value.operations).toHaveLength(1);
    expect(exit.value.operations[0]).toMatchObject({
      status: "failed",
      tokenText: sourceToken,
    });
    expect(JSON.parse(exit.value.operations[0]?.error ?? "")).toMatchObject({
      _tag: "MintUnreachable",
      mint,
    });
    expect(events.map((event) => event._tag)).toEqual([
      "OperationChanged",
      "OperationChanged",
      "OperationFailed",
    ]);
    expect(events[1]).toMatchObject({ from: "pending", to: "failed" });
  });

  it("fails the receive with the serialized error on definitive rejection", async () => {
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
    expect(exit.value.proofs).toEqual([]);
    expect(exit.value.operations[0]?.status).toBe("failed");
    expect(JSON.parse(exit.value.operations[0]?.error ?? "")).toMatchObject({
      _tag: "MintRejected",
      code: 20003,
    });
  });

  it("classifies spent inputs as TokenAlreadySpent and records it", async () => {
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
    expect(exit.value.operations[0]?.status).toBe("failed");
    expect(JSON.parse(exit.value.operations[0]?.error ?? "")).toMatchObject({
      _tag: "TokenAlreadySpent",
    });
  });

  it("retries a failed receive when the same text is pasted again", async () => {
    let attempts = 0;
    const { wallet, receiveCounters } = makeWallet({
      receive: () => {
        attempts += 1;
        return attempts === 1
          ? Promise.reject(new TypeError("fetch failed"))
          : Promise.resolve(receivedProofs);
      },
    });
    const { run, events } = makeHarness(wallet);

    const exit = await run(
      Effect.gen(function* () {
        const first = yield* Effect.flip(receiveText(sourceToken));
        const second = yield* receiveText(sourceToken);
        return { first, second, ...(yield* inventory) };
      }),
    );
    assert(Exit.isSuccess(exit));
    expect(exit.value.first._tag).toBe("MintUnreachable");
    expect(exit.value.second.amount).toBe(5);
    // One transfer for the text: the retry lands on the same operation.
    expect(exit.value.operations).toHaveLength(1);
    expect(exit.value.operations[0]).toMatchObject({
      id: exit.value.second.operationId,
      status: "done",
      error: null,
    });
    expect(secretsOf(exit.value.proofs)).toEqual(["rcv-a", "rcv-b"]);
    expect(receiveCounters).toEqual([1, 1]);
    expect(
      events
        .filter((event) => event._tag === "OperationChanged")
        .map((event) => [event.from, event.to]),
    ).toEqual([
      [null, "pending"],
      ["pending", "failed"],
      [null, "pending"],
      ["pending", "done"],
    ]);
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
        yield* receiveText(sourceToken);
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
    expect(exit.value.operations[0]?.status).toBe("failed");
  });
});
