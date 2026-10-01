import type { Proof } from "@cashu/cashu-ts";
import {
  getEncodedToken,
  HttpResponseError,
  Keyset,
  MintOperationError,
} from "@cashu/cashu-ts";
import {
  Clock,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Option,
  TestClock,
  TestContext,
} from "effect";
import { MintRejected, MintUnreachable } from "../domain/errors";
import {
  CurrencyUnit,
  KeysetId,
  MintUrl,
  OperationId,
  TokenText,
} from "../domain/primitives";
import { deterministicCounterKey } from "../internal/counters";
import { WalletInstances } from "../mint/internal/WalletInstances";
import type { LoadedWallet } from "../mint/internal/WalletInstances";
import { inMemoryKeyValueStore } from "../ports/inMemoryKeyValueStore";
import {
  inMemoryOperationStore,
  makeInMemoryOperationStore,
} from "../ports/inMemoryOperationStore";
import { inMemoryProofStore } from "../ports/inMemoryProofStore";
import { KeyValueStore } from "../ports/KeyValueStore";
import { OperationStore } from "../ports/OperationStore";
import type { OperationStoreService } from "../ports/OperationStore";
import { ProofStore } from "../ports/ProofStore";
import {
  answerProofStates,
  fakeMintInfo,
  fakeReceiveSwap,
  fakeWallet,
  KEYSET_HEX,
  proof,
} from "../testing/fakeWallet";
import type { ProofStateName } from "../testing/fakeWallet";
import { runOnTestClock, settlePromises } from "../testing/clock";
import { recordingInspector } from "../testing/inspector";
import { secretsOf, seedProofs, seedTransfer } from "../testing/inventory";
import { parseTokenText } from "../token/codec";
import { ReceiveDraft } from "./domain";
import { Inspector } from "../inspector/Inspector";
import { Receive } from "./Receive";
import { receiveTokenText, withReceiveLock } from "./internal/acceptFlow";

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
  /** The mint's keysets as the wallet knows them; none (fee-free) by default. */
  keysets?: Keyset[];
  /** Refreshes `keysets` from the mint; fails by default. */
  loadMint?: LoadedWallet["loadMint"];
  receive: (counter: number) => Promise<Proof[]>;
  restore?: () => Promise<{
    proofs: Proof[];
    lastCounterWithSignature?: number;
  }>;
  /** The mint's NUT-07 answer; everything unspent by default. */
  stateOf?: (secret: string) => ProofStateName;
  /** Replaces the NUT-07 answer `stateOf` gives. */
  checkProofsStates?: LoadedWallet["checkProofsStates"];
  /** Whether the mint's info lists NUT-07; it does by default. */
  advertisesStateCheck?: boolean;
}

const makeWallet = (args: FakeWalletArgs) => {
  const receiveCounters: number[] = [];
  const restoreCalls: Array<{ start: number; count: number }> = [];
  const wallet = fakeWallet({
    keysetId: args.keysetId ?? KEYSET_HEX,
    keyChain: { getKeysets: () => args.keysets ?? [] },
    getMintInfo: () => fakeMintInfo(args.advertisesStateCheck ?? true),
    loadMint: args.loadMint ?? (() => Promise.reject(new TypeError("offline"))),
    checkProofsStates:
      args.checkProofsStates ?? answerProofStates(args.stateOf),
    ...fakeReceiveSwap((_token, counter) => {
      receiveCounters.push(counter);
      return args.receive(counter);
    }),
    restore: (start, count) => {
      restoreCalls.push({ start, count });
      return args.restore
        ? args.restore()
        : Promise.reject(new Error("restore unavailable"));
    },
  });
  return { wallet, receiveCounters, restoreCalls };
};

interface HarnessOptions {
  /** The mint's wallet load; succeeds with the wallet by default. */
  load?: (
    mint: MintUrl,
  ) => Effect.Effect<LoadedWallet, MintUnreachable | MintRejected>;
  /** Shared with the test when its fake mint must change stored operations. */
  operationStore?: OperationStoreService;
}

const makeHarness = (
  wallet: LoadedWallet,
  { load, operationStore }: HarnessOptions = {},
) => {
  const inspector = recordingInspector();
  const layer = Receive.DefaultWithoutDependencies.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        Layer.succeed(
          WalletInstances,
          WalletInstances.make({
            get: load ?? (() => Effect.succeed(wallet)),
          }),
        ),
        inMemoryKeyValueStore,
        inMemoryProofStore,
        operationStore === undefined
          ? inMemoryOperationStore
          : Layer.succeed(OperationStore, operationStore),
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

  it("refuses a token the mint's input fee would consume, before calling the mint", async () => {
    // 100 ppk: swapping one proof costs 1 sat, so a 1-sat token nets nothing.
    const { wallet, receiveCounters } = makeWallet({
      keysets: [new Keyset(KEYSET_HEX, "sat", true, 100)],
      receive: () => Promise.reject(new Error("must not be called")),
    });
    const { run } = makeHarness(wallet);
    const dust = getEncodedToken({
      mint,
      unit: "sat",
      proofs: [proof(1, "dust")],
    });

    const exit = await run(receiveAndInspect(dust));
    assert(Exit.isSuccess(exit));
    assert(exit.value.receipt._tag === "Left");
    expect(exit.value.receipt.left).toMatchObject({
      _tag: "AmountConsumedByFee",
      mint,
      amount: 1,
      fee: 1,
    });
    expect(exit.value.proofs).toEqual([]);
    expect(exit.value.operations).toEqual([]);
    expect(receiveCounters).toEqual([]);
  });

  it("charges the fee per proof and lets a token through that nets something", async () => {
    // Two proofs at 100 ppk cost 1 sat together; the token is worth 2.
    const { wallet, receiveCounters } = makeWallet({
      keysets: [new Keyset(KEYSET_HEX, "sat", true, 100)],
      receive: () => Promise.resolve([proof(1, "rcv")]),
    });
    const { run } = makeHarness(wallet);
    const token = getEncodedToken({
      mint,
      unit: "sat",
      proofs: [proof(1, "a"), proof(1, "b")],
    });

    const exit = await run(receiveAndInspect(token));
    assert(Exit.isSuccess(exit));
    assert(exit.value.receipt._tag === "Right");
    expect(exit.value.receipt.right.amount).toBe(1);
    expect(receiveCounters).toHaveLength(1);
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
      keysetId: KEYSET_HEX,
      counter: 1,
    });
    expect(JSON.parse(exit.value.operations[0]?.error ?? "")).toMatchObject({
      _tag: "MintUnreachable",
      mint,
    });
    // The attempt's slots are burned before the request leaves.
    expect(events.map((event) => event._tag)).toEqual([
      "OperationChanged",
      "CounterAdvanced",
      "OperationChanged",
      "OperationFailed",
    ]);
    expect(events[2]).toMatchObject({ from: "pending", to: "failed" });
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

  it("refuses a token the mint already reports spent and records nothing", async () => {
    const { wallet, receiveCounters } = makeWallet({
      stateOf: (secret) => (secret === "src-a" ? "SPENT" : "UNSPENT"),
      receive: () => Promise.reject(new Error("must not be called")),
    });
    const { run, events } = makeHarness(wallet);

    const exit = await run(receiveAndInspect(sourceToken));
    assert(Exit.isSuccess(exit));
    assert(exit.value.receipt._tag === "Left");
    expect(exit.value.receipt.left).toMatchObject({
      _tag: "TokenAlreadySpent",
      mint,
    });
    expect(exit.value.operations).toEqual([]);
    expect(exit.value.proofs).toEqual([]);
    expect(receiveCounters).toEqual([]);
    expect(events.map((event) => event._tag)).toEqual(["OperationFailed"]);
  });

  it.each([
    ["cannot be reached", () => Promise.reject(new TypeError("fetch failed"))],
    [
      "rate-limits it",
      () => Promise.reject(new HttpResponseError("Too Many Requests", 429)),
    ],
    [
      "answers PENDING",
      answerProofStates((secret) => (secret === "src-a" ? "PENDING" : "SPENT")),
    ],
    [
      "answers for only some proofs",
      (proofs: Parameters<LoadedWallet["checkProofsStates"]>[0]) =>
        answerProofStates(() => "SPENT")(proofs.slice(1)),
    ],
  ] as const)(
    "defers, writing nothing under the id of another device's unsynced done receive, when the mint %s",
    async (_, checkProofsStates) => {
      // The restored device has not synced the other device's receive yet;
      // a row it wrote for the text would take the same id and sync over it.
      const elsewhere = await Effect.runPromise(
        seedTransfer("receive", "done", mint, sourceToken, 6).pipe(
          Effect.provideService(OperationStore, makeInMemoryOperationStore()),
        ),
      );
      const { wallet, receiveCounters } = makeWallet({
        checkProofsStates,
        receive: () =>
          Promise.reject(new MintOperationError(11001, "Token already spent.")),
      });
      const { run, events } = makeHarness(wallet);

      const exit = await run(receiveAndInspect(sourceToken));
      assert(Exit.isSuccess(exit));
      assert(exit.value.receipt._tag === "Left");
      const deferred = exit.value.receipt.left;
      assert(deferred._tag === "ReceiveDeferred");
      expect(deferred).toMatchObject({ mint, amount: 6 });
      expect(deferred.operationId).not.toBe(elsewhere.id);
      expect(exit.value.operations).toEqual([
        expect.objectContaining({
          id: deferred.operationId,
          kind: "deferredReceive",
          status: "pending",
          tokenText: sourceToken,
          amount: 6,
        }),
      ]);
      expect(receiveCounters).toEqual([]);
      expect(
        events.filter((event) => event._tag === "OperationChanged"),
      ).toEqual([
        expect.objectContaining({
          kind: "deferredReceive",
          from: null,
          to: "pending",
          reason: "deferred-receive",
        }),
      ]);
    },
  );

  describe("a v4 token whose short v2 keyset id the cached keysets lack", () => {
    const v2KeysetId =
      "01ba87f253ad005f869fbd4828d14bb912c907c266202d34ff4cab9e761ce39104";
    const v2Token = TokenText.make(
      getEncodedToken({
        mint,
        unit: "sat",
        proofs: sourceProofs.map((source) => ({ ...source, id: v2KeysetId })),
      }),
    );

    it("fails TokenParseFailed, writing nothing over another device's unsynced done receive, when the refreshed keysets do not resolve it", async () => {
      const elsewhere = await Effect.runPromise(
        seedTransfer("receive", "done", mint, v2Token, 6).pipe(
          Effect.provideService(OperationStore, makeInMemoryOperationStore()),
        ),
      );
      let refreshes = 0;
      let stateChecks = 0;
      const { wallet, receiveCounters } = makeWallet({
        loadMint: () => {
          refreshes += 1;
          return Promise.resolve();
        },
        checkProofsStates: (proofs) => {
          stateChecks += 1;
          return answerProofStates(() => "SPENT")(proofs);
        },
        receive: () =>
          Promise.reject(new MintOperationError(11001, "Token already spent.")),
      });
      const { run, events } = makeHarness(wallet);

      const exit = await run(receiveAndInspect(v2Token));
      assert(Exit.isSuccess(exit));
      assert(exit.value.receipt._tag === "Left");
      expect(exit.value.receipt.left).toMatchObject({
        _tag: "TokenParseFailed",
        reason: "undecodable",
      });
      expect(
        exit.value.operations.map((operation) => operation.id),
      ).not.toContain(elsewhere.id);
      expect(exit.value.operations).toEqual([]);
      expect(refreshes).toBe(1);
      expect(stateChecks).toBe(0);
      expect(receiveCounters).toEqual([]);
      expect(
        events.filter((event) => event._tag === "OperationChanged"),
      ).toEqual([]);
    });

    const resumeDeferred = Effect.flatMap(
      Receive,
      (receive) => receive.resumeDeferred,
    );

    it("keeps the deferral while a refresh does not reach the mint, and receives it once one resolves it", async () => {
      const keysets: Keyset[] = [];
      const reachable = { now: false };
      let stateChecks = 0;
      const { wallet, receiveCounters } = makeWallet({
        keysets,
        loadMint: () => {
          if (!reachable.now) return Promise.reject(new TypeError("offline"));
          if (keysets.length === 0) {
            keysets.push(new Keyset(v2KeysetId, "sat", true, 0));
          }
          return Promise.resolve();
        },
        checkProofsStates: (proofs) => {
          stateChecks += 1;
          return answerProofStates()(proofs);
        },
        receive: () => Promise.resolve(receivedProofs),
      });
      const { run } = makeHarness(wallet);

      const exit = await run(
        Effect.gen(function* () {
          const deferred = yield* Effect.flip(receiveText(v2Token));
          const whileUnreachable = yield* resumeDeferred;
          const operationsWhileUnreachable = (yield* inventory).operations;
          reachable.now = true;
          return {
            deferred,
            whileUnreachable,
            operationsWhileUnreachable,
            once: yield* resumeDeferred,
          };
        }),
      );
      assert(Exit.isSuccess(exit));
      expect(exit.value.deferred._tag).toBe("ReceiveDeferred");
      expect(
        exit.value.whileUnreachable.map((result) => result.status),
      ).toEqual(["pending"]);
      expect(exit.value.operationsWhileUnreachable).toMatchObject([
        { kind: "deferredReceive", status: "pending" },
      ]);
      expect(exit.value.once.map((result) => result.status)).toEqual([
        "received",
      ]);
      expect(stateChecks).toBe(1);
      expect(receiveCounters).toEqual([1]);
    });

    it("closes the deferral as failed once a refresh that reached the mint does not resolve it", async () => {
      const reachable = { now: false };
      let refreshes = 0;
      const { wallet, receiveCounters } = makeWallet({
        loadMint: () => {
          refreshes += 1;
          return reachable.now
            ? Promise.resolve()
            : Promise.reject(new TypeError("offline"));
        },
        receive: () => Promise.reject(new Error("must not be called")),
      });
      const { run } = makeHarness(wallet);

      const exit = await run(
        Effect.gen(function* () {
          const deferred = yield* Effect.flip(receiveText(v2Token));
          reachable.now = true;
          return {
            deferred,
            once: yield* resumeDeferred,
            again: yield* resumeDeferred,
            ...(yield* inventory),
          };
        }),
      );
      assert(Exit.isSuccess(exit));
      expect(exit.value.deferred._tag).toBe("ReceiveDeferred");
      expect(exit.value.once.map((result) => result.status)).toEqual([
        "closed",
      ]);
      expect(exit.value.again).toEqual([]);
      expect(exit.value.operations).toEqual([
        expect.objectContaining({
          kind: "deferredReceive",
          status: "failed",
          error: expect.stringContaining("TokenParseFailed"),
        }),
      ]);
      expect(refreshes).toBe(2);
      expect(receiveCounters).toEqual([]);
    });

    it("refreshes the mint's keysets, then asks the mint before it swaps", async () => {
      const keysets: Keyset[] = [];
      let stateChecks = 0;
      const { wallet, receiveCounters } = makeWallet({
        keysets,
        loadMint: () => {
          keysets.push(new Keyset(v2KeysetId, "sat", true, 0));
          return Promise.resolve();
        },
        checkProofsStates: (proofs) => {
          stateChecks += 1;
          return answerProofStates()(proofs);
        },
        receive: () => Promise.resolve(receivedProofs),
      });
      const { run } = makeHarness(wallet);

      const exit = await run(receiveAndInspect(v2Token));
      assert(Exit.isSuccess(exit));
      expect(exit.value.receipt._tag).toBe("Right");
      expect(stateChecks).toBe(1);
      expect(receiveCounters).toEqual([1]);
    });
  });

  it("defers the token when the mint never answers the state check", async () => {
    const { wallet, receiveCounters } = makeWallet({
      checkProofsStates: () => new Promise(() => undefined),
      receive: () => Promise.reject(new Error("must not be called")),
    });
    const { run } = makeHarness(wallet);

    const exit = await run(
      runOnTestClock(
        Effect.zip(receiveAndInspect(sourceToken), Clock.currentTimeMillis),
        "1 second",
      ).pipe(Effect.provide(TestContext.TestContext)),
    );
    assert(Exit.isSuccess(exit));
    const [{ receipt, operations }, elapsed] = exit.value;
    assert(receipt._tag === "Left");
    expect(receipt.left._tag).toBe("ReceiveDeferred");
    expect(operations.map((operation) => operation.kind)).toEqual([
      "deferredReceive",
    ]);
    expect(receiveCounters).toEqual([]);
    expect(elapsed).toBe(15_000);
  });

  it("swaps without asking a mint that does not advertise NUT-07", async () => {
    let stateChecks = 0;
    const { wallet, receiveCounters } = makeWallet({
      advertisesStateCheck: false,
      checkProofsStates: () => {
        stateChecks += 1;
        return Promise.reject(new HttpResponseError("Not Found", 404));
      },
      receive: () => Promise.resolve(receivedProofs),
    });
    const { run } = makeHarness(wallet);

    const exit = await run(receiveAndInspect(sourceToken));
    assert(Exit.isSuccess(exit));
    expect(exit.value.receipt._tag).toBe("Right");
    expect(stateChecks).toBe(0);
    expect(receiveCounters).toEqual([1]);
  });

  it("stops when another device's receive of the text synced in while the mint answered", async () => {
    const operationStore = makeInMemoryOperationStore();
    const { wallet, receiveCounters } = makeWallet({
      checkProofsStates: (proofs) =>
        Effect.runPromise(
          seedTransfer("receive", "done", mint, sourceToken, 6).pipe(
            Effect.provideService(OperationStore, operationStore),
            Effect.andThen(() => answerProofStates()(proofs)),
          ),
        ),
      receive: () => Promise.reject(new Error("must not be called")),
    });
    const { run, events } = makeHarness(wallet, { operationStore });

    const exit = await run(receiveAndInspect(sourceToken));
    assert(Exit.isSuccess(exit));
    const { receipt, operations } = exit.value;
    assert(receipt._tag === "Left");
    expect(operations).toEqual([
      expect.objectContaining({ status: "done", error: null }),
    ]);
    expect(receipt.left).toMatchObject({
      _tag: "TokenAlreadyKnown",
      operationId: operations[0]?.id,
    });
    expect(receiveCounters).toEqual([]);
    expect(events.filter((event) => event._tag === "OperationChanged")).toEqual(
      [],
    );
  });

  it("defers a token whose mint will not load", async () => {
    const { wallet } = makeWallet({
      receive: () => Promise.reject(new Error("must not be called")),
    });
    const { run } = makeHarness(wallet, {
      load: () =>
        Effect.fail(new MintUnreachable({ mint, detail: "fetch failed" })),
    });

    const exit = await run(receiveAndInspect(sourceToken));
    assert(Exit.isSuccess(exit));
    assert(exit.value.receipt._tag === "Left");
    expect(exit.value.receipt.left._tag).toBe("ReceiveDeferred");
    expect(exit.value.operations.map((operation) => operation.kind)).toEqual([
      "deferredReceive",
    ]);
  });

  it("defers a token whose mint refuses to load, as a rate limit or a captive portal does", async () => {
    const { wallet } = makeWallet({
      receive: () => Promise.reject(new Error("must not be called")),
    });
    const { run } = makeHarness(wallet, {
      load: () =>
        Effect.fail(
          new MintRejected({ mint, code: null, detail: "Too Many Requests" }),
        ),
    });

    const exit = await run(receiveAndInspect(sourceToken));
    assert(Exit.isSuccess(exit));
    assert(exit.value.receipt._tag === "Left");
    expect(exit.value.receipt.left._tag).toBe("ReceiveDeferred");
    expect(exit.value.operations.map((operation) => operation.kind)).toEqual([
      "deferredReceive",
    ]);
  });

  it("defers a token whose mint binds the wallet to a keyset it cannot derive from", async () => {
    const { wallet } = makeWallet({
      keysetId: "not-hex",
      receive: () => Promise.reject(new Error("must not be called")),
    });
    const { run } = makeHarness(wallet);

    const exit = await run(receiveAndInspect(sourceToken));
    assert(Exit.isSuccess(exit));
    assert(exit.value.receipt._tag === "Left");
    expect(exit.value.receipt.left._tag).toBe("ReceiveDeferred");
    expect(exit.value.operations.map((operation) => operation.kind)).toEqual([
      "deferredReceive",
    ]);
  });

  it("defers a token whose mint never finishes loading, once the answer budget runs out", async () => {
    const { wallet } = makeWallet({
      receive: () => Promise.reject(new Error("must not be called")),
    });
    const { run } = makeHarness(wallet, { load: () => Effect.never });

    const exit = await run(
      runOnTestClock(
        Effect.zip(receiveAndInspect(sourceToken), Clock.currentTimeMillis),
        "1 second",
      ).pipe(Effect.provide(TestContext.TestContext)),
    );
    assert(Exit.isSuccess(exit));
    const [{ receipt, operations }, elapsed] = exit.value;
    assert(receipt._tag === "Left");
    expect(receipt.left._tag).toBe("ReceiveDeferred");
    expect(operations.map((operation) => operation.kind)).toEqual([
      "deferredReceive",
    ]);
    expect(elapsed).toBe(15_000);
  });

  it("receives at another mint while one mint stalls", async () => {
    const otherMint = MintUrl.make("https://other.example");
    const otherToken = TokenText.make(
      getEncodedToken({
        mint: otherMint,
        unit: "sat",
        proofs: [proof(8, "other")],
      }),
    );
    const { wallet } = makeWallet({
      receive: () => Promise.resolve(receivedProofs),
    });
    const { run } = makeHarness(wallet, {
      load: (loading) =>
        loading === mint ? Effect.never : Effect.succeed(wallet),
    });

    const exit = await run(
      Effect.gen(function* () {
        yield* TestClock.setTime(1_700_000_000_000);
        const stalled = yield* Effect.fork(
          Effect.flip(receiveText(sourceToken)),
        );
        yield* settlePromises;
        const received = yield* receiveText(otherToken);
        const stalledMeanwhile = Option.isNone(yield* Fiber.poll(stalled));
        yield* TestClock.adjust("15 seconds");
        const deferred = yield* Fiber.join(stalled);
        return { received, stalledMeanwhile, deferred, ...(yield* inventory) };
      }).pipe(Effect.provide(TestContext.TestContext)),
    );
    assert(Exit.isSuccess(exit));
    expect(exit.value.received.mint).toBe(otherMint);
    expect(exit.value.stalledMeanwhile).toBe(true);
    expect(exit.value.deferred._tag).toBe("ReceiveDeferred");
    expect(
      exit.value.operations.map((operation) => [
        operation.kind,
        operation.mint,
        operation.status,
      ]),
    ).toEqual([
      ["receive", otherMint, "done"],
      ["deferredReceive", mint, "pending"],
    ]);
  });

  it("reuses a pending deferral when the same text arrives again", async () => {
    const { wallet } = makeWallet({
      checkProofsStates: () => Promise.reject(new TypeError("fetch failed")),
      receive: () => Promise.reject(new Error("must not be called")),
    });
    const { run, events } = makeHarness(wallet);

    const exit = await run(
      Effect.gen(function* () {
        const first = yield* Effect.flip(receiveText(sourceToken));
        const second = yield* Effect.flip(receiveText(sourceToken));
        return { first, second, ...(yield* inventory) };
      }),
    );
    assert(Exit.isSuccess(exit));
    assert(exit.value.first._tag === "ReceiveDeferred");
    assert(exit.value.second._tag === "ReceiveDeferred");
    expect(exit.value.second.operationId).toBe(exit.value.first.operationId);
    expect(exit.value.operations).toHaveLength(1);
    expect(
      events.filter((event) => event._tag === "OperationChanged"),
    ).toHaveLength(1);
  });

  it("does not defer a text another transfer already carries", async () => {
    const { wallet } = makeWallet({
      receive: () => Promise.reject(new Error("must not be called")),
    });
    const { run } = makeHarness(wallet, {
      load: () => Effect.fail(new MintUnreachable({ mint, detail: null })),
    });

    const exit = await run(
      Effect.gen(function* () {
        const done = yield* seedTransfer(
          "receive",
          "done",
          mint,
          sourceToken,
          6,
        );
        const error = yield* Effect.flip(receiveText(sourceToken));
        return { done, error, ...(yield* inventory) };
      }),
    );
    assert(Exit.isSuccess(exit));
    expect(exit.value.error).toMatchObject({
      _tag: "TokenAlreadyKnown",
      operationId: exit.value.done.id,
    });
    expect(exit.value.operations).toHaveLength(1);
  });

  it("leaves an unfinished receive to its own resume when its mint will not load", async () => {
    const { wallet } = makeWallet({
      receive: () => Promise.reject(new Error("must not be called")),
    });
    const { run } = makeHarness(wallet, {
      load: () => Effect.fail(new MintUnreachable({ mint, detail: null })),
    });

    const exit = await run(
      Effect.gen(function* () {
        const interrupted = yield* seedTransfer(
          "receive",
          "pending",
          mint,
          sourceToken,
          6,
        );
        const error = yield* Effect.flip(receiveText(sourceToken));
        return { interrupted, error, ...(yield* inventory) };
      }),
    );
    assert(Exit.isSuccess(exit));
    expect(exit.value.error._tag).toBe("MintUnreachable");
    expect(exit.value.operations).toEqual([
      expect.objectContaining({
        id: exit.value.interrupted.id,
        status: "pending",
      }),
    ]);
  });

  it("hands a deferral over to the receive of a later paste that lands", async () => {
    const reachable = { now: false };
    const { wallet } = makeWallet({
      receive: () => Promise.resolve(receivedProofs),
    });
    const { run } = makeHarness(wallet, {
      load: () =>
        reachable.now
          ? Effect.succeed(wallet)
          : Effect.fail(new MintUnreachable({ mint, detail: null })),
    });

    const exit = await run(
      Effect.gen(function* () {
        yield* Effect.flip(receiveText(sourceToken));
        reachable.now = true;
        yield* receiveText(sourceToken);
        return yield* inventory;
      }),
    );
    assert(Exit.isSuccess(exit));
    expect(
      exit.value.operations.map((operation) => [
        operation.kind,
        operation.status,
      ]),
    ).toEqual([
      ["deferredReceive", "done"],
      ["receive", "done"],
    ]);
  });

  it("records a swap the mint rejects as spent after an unspent check as failed", async () => {
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
    // The failed attempt's slots stay burned; the retry swaps past them.
    expect(receiveCounters).toEqual([1, 3]);
    expect(
      events
        .filter((event) => event._tag === "OperationChanged")
        .map((event) => [event.from, event.to]),
    ).toEqual([
      [null, "pending"],
      ["pending", "failed"],
      ["failed", "pending"],
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
      expect.objectContaining({ from: 1, to: 3, reason: "used" }),
      expect.objectContaining({
        from: 3,
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

  it("keeps a second receive of the text out while a slow swap outlasts the counter lease", async () => {
    let spent = false;
    let answerFirstSwap = () => {};
    const firstSwapAnswered = new Promise<void>((resolve) => {
      answerFirstSwap = resolve;
    });
    const { wallet, receiveCounters } = makeWallet({
      receive: async () => {
        if (receiveCounters.length === 1) await firstSwapAnswered;
        if (spent) throw new MintOperationError(11001, "Token already spent.");
        spent = true;
        return receivedProofs;
      },
    });
    const { run } = makeHarness(wallet);

    const exit = await run(
      Effect.gen(function* () {
        yield* TestClock.setTime(1_700_000_000_000);
        const receipts = yield* runOnTestClock(
          Effect.all(
            [
              Effect.either(receiveText(sourceToken)),
              Effect.delay(
                Effect.either(receiveText(sourceToken)),
                "16 seconds",
              ),
              Effect.delay(Effect.sync(answerFirstSwap), "17 seconds"),
            ],
            { concurrency: "unbounded" },
          ),
          "1 second",
        );
        return { receipts, ...(yield* inventory) };
      }).pipe(Effect.provide(TestContext.TestContext)),
    );
    assert(Exit.isSuccess(exit));
    const {
      receipts: [first, second],
      operations,
    } = exit.value;
    expect(first._tag).toBe("Right");
    assert(second._tag === "Left");
    expect(second.left._tag).toBe("TokenAlreadyKnown");
    expect(receiveCounters).toHaveLength(1);
    expect(operations).toEqual([
      expect.objectContaining({ kind: "receive", status: "done" }),
    ]);
  });

  it("keeps a second receive of the text out while it runs in a context whose wallet binds a newer keyset", async () => {
    let spent = false;
    let answerFirstSwap = () => {};
    const firstSwapAnswered = new Promise<void>((resolve) => {
      answerFirstSwap = resolve;
    });
    const swaps: string[] = [];
    const walletBoundTo = (keysetId: string) =>
      makeWallet({
        keysetId,
        receive: async () => {
          swaps.push(keysetId);
          if (swaps.length === 1) await firstSwapAnswered;
          if (spent)
            throw new MintOperationError(11001, "Token already spent.");
          spent = true;
          return receivedProofs;
        },
      }).wallet;
    const olderKeyset = walletBoundTo(KEYSET_HEX);
    const newerKeyset = walletBoundTo("00c0ffee00c0ffee");
    const { run } = makeHarness(olderKeyset);

    const exit = await run(
      Effect.gen(function* () {
        yield* TestClock.setTime(1_700_000_000_000);
        const stores = {
          kv: yield* KeyValueStore,
          proofStore: yield* ProofStore,
          operationStore: yield* OperationStore,
          inspector: yield* Inspector.orNoop,
        };
        const receiveIn = (wallet: LoadedWallet) =>
          Effect.either(
            receiveTokenText(
              {
                ...stores,
                instances: WalletInstances.make({
                  get: () => Effect.succeed(wallet),
                }),
              },
              sourceToken,
              null,
            ),
          );
        const receipts = yield* runOnTestClock(
          Effect.all(
            [
              receiveIn(olderKeyset),
              Effect.delay(receiveIn(newerKeyset), "1 second"),
              Effect.delay(Effect.sync(answerFirstSwap), "2 seconds"),
            ],
            { concurrency: "unbounded" },
          ),
          "100 millis",
        );
        return { receipts, ...(yield* inventory) };
      }).pipe(Effect.provide(TestContext.TestContext)),
    );
    assert(Exit.isSuccess(exit));
    const {
      receipts: [first, second],
      operations,
    } = exit.value;
    expect(first._tag).toBe("Right");
    assert(second._tag === "Left");
    expect(second.left._tag).toBe("TokenAlreadyKnown");
    expect(swaps).toEqual([KEYSET_HEX]);
    expect(operations).toEqual([
      expect.objectContaining({ kind: "receive", status: "done" }),
    ]);
  });

  it("writes nothing and fails CounterLockTimeout without a keyset when another context holds the mint's receives for 30 s", async () => {
    const { wallet, receiveCounters } = makeWallet({
      receive: () => Promise.resolve(receivedProofs),
    });
    const { run } = makeHarness(wallet);

    const exit = await run(
      Effect.gen(function* () {
        yield* Effect.fork(
          Effect.never.pipe(
            withReceiveLock(yield* KeyValueStore, {
              mint,
              unit: CurrencyUnit.make("sat"),
            }),
          ),
        );
        const receipt = yield* runOnTestClock(
          Effect.either(receiveText(sourceToken)),
          "1 second",
        );
        return { receipt, ...(yield* inventory) };
      }).pipe(Effect.provide(TestContext.TestContext)),
    );
    assert(Exit.isSuccess(exit));
    assert(exit.value.receipt._tag === "Left");
    expect(exit.value.receipt.left).toMatchObject({
      _tag: "CounterLockTimeout",
      mint,
      keysetId: null,
    });
    expect(receiveCounters).toEqual([]);
    expect(exit.value.operations).toEqual([]);
  });
});

/** A receive a reload cut short after its swap attempt at slot 1 left. */
const seedInterruptedReceive = Effect.gen(function* () {
  const transfer = yield* seedTransfer(
    "receive",
    "pending",
    mint,
    sourceToken,
    6,
  );
  yield* (yield* OperationStore).update(transfer.id, {
    keysetId: KeysetId.make(KEYSET_HEX),
    counter: 1,
  });
  yield* (yield* KeyValueStore).set(counterKey, "3");
  return transfer;
});

/** The mint after it swapped the source token. */
const sourceSpent = (secret: string): ProofStateName =>
  secret.startsWith("src-") ? "SPENT" : "UNSPENT";

describe("Receive.receive of an unfinished receive", () => {
  it("finishes a pending receive from the outputs the mint already signed, asking about its inputs once", async () => {
    const checked: string[][] = [];
    const { wallet, receiveCounters, restoreCalls } = makeWallet({
      receive: () => Promise.reject(new Error("must not be called")),
      restore: () => Promise.resolve({ proofs: receivedProofs }),
      checkProofsStates: (proofs) => {
        checked.push(proofs.map((entry) => entry.secret ?? ""));
        return answerProofStates(sourceSpent)(proofs);
      },
    });
    const { run } = makeHarness(wallet);

    const exit = await run(
      Effect.gen(function* () {
        const transfer = yield* seedInterruptedReceive;
        return { transfer, ...(yield* receiveAndInspect(sourceToken)) };
      }),
    );
    assert(Exit.isSuccess(exit));
    const { transfer, receipt, proofs, operations, counter } = exit.value;
    assert(receipt._tag === "Right");
    expect(receipt.right).toMatchObject({
      operationId: transfer.id,
      amount: 5,
    });
    expect(restoreCalls).toEqual([{ start: 1, count: 2 }]);
    expect(receiveCounters).toEqual([]);
    expect(checked).toEqual([
      ["src-a", "src-b"],
      ["rcv-a", "rcv-b"],
    ]);
    expect(secretsOf(proofs)).toEqual(["rcv-a", "rcv-b"]);
    expect(operations).toEqual([
      expect.objectContaining({ id: transfer.id, status: "done" }),
    ]);
    expect(counter).toBe("3");
  });

  it("closes the receive without storing twice when the proofs were already stored", async () => {
    const { wallet } = makeWallet({
      receive: () => Promise.reject(new Error("must not be called")),
      restore: () => Promise.resolve({ proofs: receivedProofs }),
      stateOf: sourceSpent,
    });
    const { run } = makeHarness(wallet);

    const exit = await run(
      Effect.gen(function* () {
        yield* seedInterruptedReceive;
        yield* seedProofs(mint, receivedProofs);
        return yield* receiveAndInspect(sourceToken);
      }),
    );
    assert(Exit.isSuccess(exit));
    assert(exit.value.receipt._tag === "Right");
    expect(exit.value.receipt.right.amount).toBe(5);
    expect(secretsOf(exit.value.proofs)).toEqual(["rcv-a", "rcv-b"]);
    expect(exit.value.operations[0]?.status).toBe("done");
  });

  it("swaps past the burned slots, asking about its inputs once, when the interrupted attempt never reached the mint", async () => {
    let checks = 0;
    const { wallet, receiveCounters, restoreCalls } = makeWallet({
      receive: () => Promise.resolve(receivedProofs),
      restore: () => Promise.resolve({ proofs: [] }),
      checkProofsStates: (proofs) => {
        checks += 1;
        return answerProofStates()(proofs);
      },
    });
    const { run } = makeHarness(wallet);

    const exit = await run(
      Effect.gen(function* () {
        yield* seedInterruptedReceive;
        return yield* receiveAndInspect(sourceToken);
      }),
    );
    assert(Exit.isSuccess(exit));
    assert(exit.value.receipt._tag === "Right");
    expect(checks).toBe(1);
    expect(restoreCalls).toEqual([]);
    expect(receiveCounters).toEqual([3]);
    expect(exit.value.operations[0]).toMatchObject({
      status: "done",
      counter: 3,
    });
  });

  it("recovers a swap whose response was lost on the next receive of the text", async () => {
    let swapped = false;
    const { wallet, receiveCounters, restoreCalls } = makeWallet({
      receive: () => {
        swapped = true;
        return Promise.reject(new TypeError("fetch failed"));
      },
      restore: () => Promise.resolve({ proofs: receivedProofs }),
      stateOf: (secret) => (swapped ? sourceSpent(secret) : "UNSPENT"),
    });
    const { run } = makeHarness(wallet);

    const exit = await run(
      Effect.gen(function* () {
        const lost = yield* Effect.flip(receiveText(sourceToken));
        return { lost, ...(yield* receiveAndInspect(sourceToken)) };
      }),
    );
    assert(Exit.isSuccess(exit));
    expect(exit.value.lost._tag).toBe("MintUnreachable");
    assert(exit.value.receipt._tag === "Right");
    expect(exit.value.receipt.right.amount).toBe(5);
    expect(receiveCounters).toEqual([1]);
    expect(restoreCalls).toEqual([{ start: 1, count: 2 }]);
    expect(exit.value.operations[0]?.status).toBe("done");
  });

  it("leaves an interrupted receive as it stood when its slot holds nothing and the token is spent", async () => {
    // Another device received the token at a slot this row never recorded.
    const { wallet, receiveCounters, restoreCalls } = makeWallet({
      receive: () => Promise.reject(new Error("must not be called")),
      restore: () => Promise.resolve({ proofs: [] }),
      stateOf: sourceSpent,
    });
    const { run, events } = makeHarness(wallet);

    const exit = await run(
      Effect.gen(function* () {
        yield* seedInterruptedReceive;
        return yield* receiveAndInspect(sourceToken);
      }),
    );
    assert(Exit.isSuccess(exit));
    assert(exit.value.receipt._tag === "Left");
    expect(exit.value.receipt.left._tag).toBe("TokenAlreadySpent");
    expect(restoreCalls).toEqual([{ start: 1, count: 2 }]);
    expect(receiveCounters).toEqual([]);
    expect(exit.value.operations).toEqual([
      expect.objectContaining({ status: "pending", error: null, counter: 1 }),
    ]);
    expect(events.filter((event) => event._tag === "OperationChanged")).toEqual(
      [],
    );
  });

  it("leaves a failed receive as it stood when the mint reports its token spent", async () => {
    const unreachable = JSON.stringify({ _tag: "MintUnreachable", mint });
    const { wallet, receiveCounters } = makeWallet({
      receive: () => Promise.reject(new Error("must not be called")),
      stateOf: sourceSpent,
    });
    const { run, events } = makeHarness(wallet);

    const exit = await run(
      Effect.gen(function* () {
        yield* seedTransfer(
          "receive",
          "failed",
          mint,
          sourceToken,
          6,
          unreachable,
        );
        return yield* receiveAndInspect(sourceToken);
      }),
    );
    assert(Exit.isSuccess(exit));
    assert(exit.value.receipt._tag === "Left");
    expect(exit.value.receipt.left._tag).toBe("TokenAlreadySpent");
    expect(receiveCounters).toEqual([]);
    expect(exit.value.operations).toEqual([
      expect.objectContaining({ status: "failed", error: unreachable }),
    ]);
    expect(events.filter((event) => event._tag === "OperationChanged")).toEqual(
      [],
    );
  });

  it("swaps again when the recorded slot holds another token's outputs", async () => {
    const otherOutputs = [proof(4, "other-a"), proof(1, "other-b")];
    const { wallet, receiveCounters } = makeWallet({
      receive: () => Promise.resolve(receivedProofs),
      restore: () => Promise.resolve({ proofs: otherOutputs }),
    });
    const { run } = makeHarness(wallet);

    const exit = await run(
      Effect.gen(function* () {
        yield* seedInterruptedReceive;
        return yield* receiveAndInspect(sourceToken);
      }),
    );
    assert(Exit.isSuccess(exit));
    assert(exit.value.receipt._tag === "Right");
    expect(receiveCounters).toEqual([3]);
    expect(secretsOf(exit.value.proofs)).toEqual(["rcv-a", "rcv-b"]);
  });

  it("swaps again without asking about its slot or inputs on a mint that does not advertise NUT-07", async () => {
    let stateChecks = 0;
    const { wallet, receiveCounters, restoreCalls } = makeWallet({
      advertisesStateCheck: false,
      checkProofsStates: () => {
        stateChecks += 1;
        return Promise.reject(new HttpResponseError("Not Found", 404));
      },
      receive: () => Promise.resolve(receivedProofs),
      restore: () => Promise.resolve({ proofs: receivedProofs }),
    });
    const { run } = makeHarness(wallet);

    const exit = await run(
      Effect.gen(function* () {
        yield* seedInterruptedReceive;
        return yield* receiveAndInspect(sourceToken);
      }),
    );
    assert(Exit.isSuccess(exit));
    assert(exit.value.receipt._tag === "Right");
    expect(stateChecks).toBe(0);
    expect(restoreCalls).toEqual([]);
    expect(receiveCounters).toEqual([3]);
    expect(exit.value.operations[0]).toMatchObject({
      status: "done",
      counter: 3,
    });
  });

  it("leaves the receive as it stood when the mint leaves a restored proof's state unanswered", async () => {
    const { wallet, receiveCounters } = makeWallet({
      receive: () => Promise.reject(new Error("must not be called")),
      restore: () => Promise.resolve({ proofs: receivedProofs }),
      stateOf: (secret) =>
        secret === "rcv-b" ? "PENDING" : sourceSpent(secret),
    });
    const { run } = makeHarness(wallet);

    const exit = await run(
      Effect.gen(function* () {
        yield* seedInterruptedReceive;
        return yield* receiveAndInspect(sourceToken);
      }),
    );
    assert(Exit.isSuccess(exit));
    assert(exit.value.receipt._tag === "Left");
    expect(exit.value.receipt.left._tag).toBe("MintUnreachable");
    expect(receiveCounters).toEqual([]);
    expect(exit.value.proofs).toEqual([]);
    expect(exit.value.operations[0]).toMatchObject({
      status: "pending",
      counter: 1,
    });
  });

  it("leaves a replaced transfer another context finished meanwhile untouched", async () => {
    const { wallet, receiveCounters } = makeWallet({
      receive: () => Promise.reject(new Error("must not be called")),
    });
    const { run } = makeHarness(wallet);

    const exit = await run(
      Effect.gen(function* () {
        const stale = yield* seedTransfer(
          "receive",
          "failed",
          mint,
          sourceToken,
          6,
        );
        yield* (yield* OperationStore).update(stale.id, { status: "done" });
        const ctx = {
          kv: yield* KeyValueStore,
          proofStore: yield* ProofStore,
          operationStore: yield* OperationStore,
          instances: yield* WalletInstances,
          inspector: yield* Inspector.orNoop,
        };
        const result = yield* Effect.either(
          receiveTokenText(ctx, sourceToken, {
            operation: stale,
            reason: "returnToWallet",
          }),
        );
        return { stale, result };
      }),
    );
    assert(Exit.isSuccess(exit));
    assert(exit.value.result._tag === "Left");
    expect(exit.value.result.left).toMatchObject({
      _tag: "TokenAlreadyKnown",
      operationId: exit.value.stale.id,
    });
    expect(receiveCounters).toEqual([]);
  });
});

describe("Receive.resumeDeferred", () => {
  const resumeDeferred = Effect.flatMap(
    Receive,
    (receive) => receive.resumeDeferred,
  );

  /** A mint whose state check fails until `reachable.now` is set. */
  const flakyMint = (stateOf?: (secret: string) => ProofStateName) => {
    const reachable = { now: false };
    let stateChecks = 0;
    const answer = answerProofStates(stateOf);
    const harness = makeWallet({
      checkProofsStates: (proofs) => {
        stateChecks += 1;
        return reachable.now
          ? answer(proofs)
          : Promise.reject(new TypeError("fetch failed"));
      },
      receive: () => Promise.resolve(receivedProofs),
    });
    return { ...harness, reachable, stateChecks: () => stateChecks };
  };

  /** A wallet load that fails as unreachable until `up.now` is set. */
  const loadWhenUp = (wallet: LoadedWallet) => {
    const up = { now: false };
    const load = () =>
      up.now
        ? Effect.succeed(wallet)
        : Effect.fail(new MintUnreachable({ mint, detail: "fetch failed" }));
    return { up, load };
  };

  const closeStored = (id: OperationId) =>
    Effect.flatMap(OperationStore, (store) =>
      store.update(id, { status: "done" }),
    );

  it("receives a deferred token once its mint answers, and closes the deferral", async () => {
    const { wallet, reachable } = flakyMint();
    const { run, events } = makeHarness(wallet);

    const exit = await run(
      Effect.gen(function* () {
        const deferred = yield* Effect.flip(receiveText(sourceToken));
        reachable.now = true;
        return {
          deferred,
          results: yield* resumeDeferred,
          ...(yield* inventory),
        };
      }),
    );
    assert(Exit.isSuccess(exit));
    const { deferred, results, operations, proofs } = exit.value;
    assert(deferred._tag === "ReceiveDeferred");
    expect(results).toHaveLength(1);
    const [result] = results;
    expect(result).toMatchObject({
      operationId: deferred.operationId,
      status: "received",
      amount: 6,
    });
    const receive = operations.find(
      (operation) => operation.kind === "receive",
    );
    expect(result?.receipt).toMatchObject({
      operationId: receive?.id,
      amount: 5,
    });
    expect(receive).toMatchObject({ status: "done", tokenText: sourceToken });
    expect(
      operations.find((operation) => operation.id === deferred.operationId),
    ).toMatchObject({ kind: "deferredReceive", status: "done" });
    expect(secretsOf(proofs)).toEqual(["rcv-a", "rcv-b"]);

    const summary = events.at(-1);
    assert(summary?._tag === "OperationSucceeded");
    expect(summary.name).toBe("receive.resumeDeferred");
    // Inspector rows never carry token text.
    expect(JSON.stringify(events)).not.toContain(sourceToken);
    expect(
      events
        .filter((event) => event._tag === "OperationChanged")
        .map((event) => [event.kind, event.from, event.to]),
    ).toEqual([
      ["deferredReceive", null, "pending"],
      ["receive", null, "pending"],
      ["deferredReceive", "pending", "done"],
      ["receive", "pending", "done"],
    ]);
  });

  it("keeps the deferral while the mint stays unreachable, asking it once per pass", async () => {
    const { wallet, stateChecks } = flakyMint();
    const { run, events } = makeHarness(wallet);
    const otherToken = TokenText.make(
      getEncodedToken({ mint, unit: "sat", proofs: [proof(8, "other")] }),
    );

    const exit = await run(
      Effect.gen(function* () {
        yield* Effect.flip(receiveText(sourceToken));
        yield* Effect.flip(receiveText(otherToken));
        return { results: yield* resumeDeferred, ...(yield* inventory) };
      }),
    );
    assert(Exit.isSuccess(exit));
    expect(exit.value.results.map((result) => result.status)).toEqual([
      "pending",
      "pending",
    ]);
    expect(stateChecks()).toBe(3);
    expect(
      exit.value.operations.map((operation) => [
        operation.kind,
        operation.status,
      ]),
    ).toEqual([
      ["deferredReceive", "pending"],
      ["deferredReceive", "pending"],
    ]);
    expect(
      events.filter((event) => event._tag === "OperationChanged"),
    ).toHaveLength(2);
    // Waiting on a mint that is still down is reported, not failed.
    expect(
      events.flatMap((event) =>
        "name" in event && event.name === "receive.resume"
          ? [[event._tag, event._tag === "OperationSucceeded" && event.result]]
          : [],
      ),
    ).toMatchObject([["OperationSucceeded", { status: "pending" }]]);
  });

  it("closes a deferral whose token the mint reports spent, without a receive", async () => {
    const { wallet, reachable } = flakyMint(() => "SPENT");
    const { run } = makeHarness(wallet);

    const exit = await run(
      Effect.gen(function* () {
        yield* Effect.flip(receiveText(sourceToken));
        reachable.now = true;
        return { results: yield* resumeDeferred, ...(yield* inventory) };
      }),
    );
    assert(Exit.isSuccess(exit));
    expect(exit.value.results.map((result) => result.status)).toEqual([
      "closed",
    ]);
    expect(exit.value.operations).toHaveLength(1);
    const [closed] = exit.value.operations;
    expect(closed).toMatchObject({ kind: "deferredReceive", status: "failed" });
    expect(JSON.parse(closed?.error ?? "")).toMatchObject({
      _tag: "TokenAlreadySpent",
    });
    expect(exit.value.proofs).toEqual([]);
  });

  it("closes a deferral another device already received, leaving its receive alone", async () => {
    const { wallet } = flakyMint();
    const { run } = makeHarness(wallet);

    const exit = await run(
      Effect.gen(function* () {
        yield* Effect.flip(receiveText(sourceToken));
        // The other device's `done` receive arrives through sync.
        yield* seedTransfer("receive", "done", mint, sourceToken, 6);
        return { results: yield* resumeDeferred, ...(yield* inventory) };
      }),
    );
    assert(Exit.isSuccess(exit));
    expect(exit.value.results.map((result) => result.status)).toEqual([
      "closed",
    ]);
    expect(
      exit.value.operations.map((operation) => [
        operation.kind,
        operation.status,
      ]),
    ).toEqual([
      ["deferredReceive", "done"],
      ["receive", "done"],
    ]);
  });

  it("records the token once when two passes run at the same time", async () => {
    const { wallet, reachable, receiveCounters } = flakyMint();
    const { run } = makeHarness(wallet);

    const exit = await run(
      Effect.gen(function* () {
        yield* Effect.flip(receiveText(sourceToken));
        reachable.now = true;
        const passes = yield* Effect.all([resumeDeferred, resumeDeferred], {
          concurrency: "unbounded",
        });
        return { passes, ...(yield* inventory) };
      }),
    );
    assert(Exit.isSuccess(exit));
    expect(exit.value.passes.flat().map((result) => result.status)).toEqual(
      expect.arrayContaining(["received", "closed"]),
    );
    expect(receiveCounters).toEqual([1]);
    expect(
      exit.value.operations.map((operation) => [
        operation.kind,
        operation.status,
      ]),
    ).toEqual([
      ["deferredReceive", "done"],
      ["receive", "done"],
    ]);
  });

  it("never brings back a deferral closed while the pass waited for the mint to load", async () => {
    const { wallet, receiveCounters } = makeWallet({
      receive: () => Promise.reject(new Error("must not be called")),
    });
    const loading = Effect.runSync(
      Deferred.make<LoadedWallet, MintUnreachable>(),
    );
    const stalls = { now: false };
    const { run, events } = makeHarness(wallet, {
      load: () =>
        stalls.now
          ? Deferred.await(loading)
          : Effect.fail(new MintUnreachable({ mint, detail: null })),
    });

    const exit = await run(
      Effect.gen(function* () {
        const deferred = yield* Effect.flip(receiveText(sourceToken));
        assert(deferred._tag === "ReceiveDeferred");
        stalls.now = true;
        const pass = yield* Effect.fork(resumeDeferred);
        yield* settlePromises;
        yield* closeStored(deferred.operationId);
        yield* Deferred.fail(
          loading,
          new MintUnreachable({ mint, detail: "fetch failed" }),
        );
        return { results: yield* Fiber.join(pass), ...(yield* inventory) };
      }),
    );
    assert(Exit.isSuccess(exit));
    expect(exit.value.results.map((result) => result.status)).toEqual([
      "pending",
    ]);
    expect(exit.value.operations).toEqual([
      expect.objectContaining({ kind: "deferredReceive", status: "done" }),
    ]);
    expect(receiveCounters).toEqual([]);
    expect(
      events
        .filter((event) => event._tag === "OperationChanged")
        .map((event) => [event.from, event.to]),
    ).toEqual([[null, "pending"]]);
  });

  it("receives nothing when the deferral is closed while the mint answers the state check", async () => {
    const operationStore = makeInMemoryOperationStore();
    const closing = { now: false };
    const { wallet, receiveCounters } = makeWallet({
      checkProofsStates: (proofs) =>
        closing.now
          ? Effect.runPromise(
              Effect.flatMap(operationStore.loadAll, (operations) =>
                Effect.forEach(operations, (operation) =>
                  operationStore.update(operation.id, { status: "done" }),
                ),
              ),
            ).then(() => answerProofStates()(proofs))
          : Promise.reject(new TypeError("fetch failed")),
      receive: () => Promise.resolve(receivedProofs),
    });
    const { run } = makeHarness(wallet, { operationStore });

    const exit = await run(
      Effect.gen(function* () {
        yield* Effect.flip(receiveText(sourceToken));
        closing.now = true;
        return { results: yield* resumeDeferred, ...(yield* inventory) };
      }),
    );
    assert(Exit.isSuccess(exit));
    expect(exit.value.results.map((result) => result.status)).toEqual([
      "closed",
    ]);
    expect(exit.value.operations).toEqual([
      expect.objectContaining({ kind: "deferredReceive", status: "done" }),
    ]);
    expect(receiveCounters).toEqual([]);
  });

  it("keeps the deferral while the mint refuses to load", async () => {
    const { wallet, receiveCounters } = makeWallet({
      receive: () => Promise.reject(new Error("must not be called")),
    });
    const { run } = makeHarness(wallet, {
      load: () =>
        Effect.fail(
          new MintRejected({ mint, code: null, detail: "Too Many Requests" }),
        ),
    });

    const exit = await run(
      Effect.gen(function* () {
        yield* Effect.flip(receiveText(sourceToken));
        return { results: yield* resumeDeferred, ...(yield* inventory) };
      }),
    );
    assert(Exit.isSuccess(exit));
    expect(exit.value.results.map((result) => result.status)).toEqual([
      "pending",
    ]);
    expect(exit.value.operations).toMatchObject([
      { kind: "deferredReceive", status: "pending", error: null },
    ]);
    expect(receiveCounters).toEqual([]);
  });

  it("keeps the deferral when the mint never finishes loading, once the answer budget runs out", async () => {
    const { wallet } = makeWallet({
      receive: () => Promise.reject(new Error("must not be called")),
    });
    const stalls = { now: false };
    const { run } = makeHarness(wallet, {
      load: () =>
        stalls.now
          ? Effect.never
          : Effect.fail(new MintUnreachable({ mint, detail: null })),
    });

    const exit = await run(
      Effect.gen(function* () {
        yield* TestClock.setTime(1_700_000_000_000);
        yield* Effect.flip(receiveText(sourceToken));
        stalls.now = true;
        const start = yield* Clock.currentTimeMillis;
        const results = yield* runOnTestClock(resumeDeferred, "1 second");
        const elapsed = (yield* Clock.currentTimeMillis) - start;
        return { results, elapsed, ...(yield* inventory) };
      }).pipe(Effect.provide(TestContext.TestContext)),
    );
    assert(Exit.isSuccess(exit));
    expect(exit.value.results.map((result) => result.status)).toEqual([
      "pending",
    ]);
    expect(exit.value.elapsed).toBe(15_000);
    expect(exit.value.operations).toMatchObject([
      { kind: "deferredReceive", status: "pending" },
    ]);
  });

  it("closes a deferral the mint's input fee would consume as failed", async () => {
    const { wallet, receiveCounters } = makeWallet({
      keysets: [new Keyset(KEYSET_HEX, "sat", true, 100)],
      receive: () => Promise.reject(new Error("must not be called")),
    });
    const { up, load } = loadWhenUp(wallet);
    const { run } = makeHarness(wallet, { load });
    const dust = getEncodedToken({
      mint,
      unit: "sat",
      proofs: [proof(1, "dust")],
    });

    const exit = await run(
      Effect.gen(function* () {
        yield* Effect.flip(receiveText(dust));
        up.now = true;
        return { results: yield* resumeDeferred, ...(yield* inventory) };
      }),
    );
    assert(Exit.isSuccess(exit));
    expect(exit.value.results.map((result) => result.status)).toEqual([
      "closed",
    ]);
    expect(exit.value.operations).toHaveLength(1);
    const [closed] = exit.value.operations;
    expect(closed).toMatchObject({ kind: "deferredReceive", status: "failed" });
    expect(JSON.parse(closed?.error ?? "")).toMatchObject({
      _tag: "AmountConsumedByFee",
    });
    expect(receiveCounters).toEqual([]);
  });

  it("closes a deferral whose text does not decode as failed", async () => {
    const { wallet } = makeWallet({
      receive: () => Promise.reject(new Error("must not be called")),
    });
    const { run } = makeHarness(wallet);

    const exit = await run(
      Effect.gen(function* () {
        yield* seedTransfer(
          "deferredReceive",
          "pending",
          mint,
          TokenText.make("cashuBnot-a-token"),
          6,
        );
        return { results: yield* resumeDeferred, ...(yield* inventory) };
      }),
    );
    assert(Exit.isSuccess(exit));
    expect(exit.value.results.map((result) => result.status)).toEqual([
      "closed",
    ]);
    const [closed] = exit.value.operations;
    expect(closed?.status).toBe("failed");
    expect(JSON.parse(closed?.error ?? "")).toMatchObject({
      _tag: "TokenParseFailed",
    });
  });

  it.each([
    ["MintUnreachable", new TypeError("fetch failed")],
    ["MintRejected", new MintOperationError(20003, "keyset inactive")],
    [
      "TokenAlreadySpent",
      new MintOperationError(11001, "Token already spent."),
    ],
  ])(
    "hands a deferral whose swap fails (%s) over to its failed receive",
    async (tag, swapError) => {
      const { wallet } = makeWallet({
        receive: () => Promise.reject(swapError),
      });
      const { up, load } = loadWhenUp(wallet);
      const { run } = makeHarness(wallet, { load });

      const exit = await run(
        Effect.gen(function* () {
          yield* Effect.flip(receiveText(sourceToken));
          up.now = true;
          return { results: yield* resumeDeferred, ...(yield* inventory) };
        }),
      );
      assert(Exit.isSuccess(exit));
      expect(exit.value.results).toMatchObject([
        { status: "failed", receipt: null },
      ]);
      const deferral = exit.value.operations.find(
        (operation) => operation.kind === "deferredReceive",
      );
      const receive = exit.value.operations.find(
        (operation) => operation.kind === "receive",
      );
      expect(deferral).toMatchObject({ status: "done", error: null });
      expect(receive).toMatchObject({
        status: "failed",
        tokenText: sourceToken,
      });
      expect(JSON.parse(receive?.error ?? "")).toMatchObject({ _tag: tag });
    },
  );

  it("returns nothing when no token is deferred", async () => {
    const { wallet } = flakyMint();
    const { run } = makeHarness(wallet);

    expect(await run(resumeDeferred)).toEqual(Exit.succeed([]));
  });
});
