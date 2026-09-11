import type { Proof as CashuProof, SendResponse } from "@cashu/cashu-ts";
import { MintOperationError } from "@cashu/cashu-ts";
import { Effect, Exit, Layer } from "effect";
import {
  Amount as SendAmount,
  CurrencyUnit,
  KeysetId,
  MintUrl,
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
import type { StoredProof } from "../ports/ProofStore";
import { fakeWallet, KEYSET_HEX, proof } from "../testing/fakeWallet";
import { recordingInspector } from "../testing/inspector";
import { proofsIn, secretsOf, seedProofs } from "../testing/inventory";
import { decodeTokenText, parseTokenText } from "../token/codec";
import { SendDraft } from "./domain";
import { Send } from "./Send";

const mint = MintUrl.make("https://mint.example");
const otherMint = "https://other.example";
const counterKey = deterministicCounterKey({
  mint,
  unit: CurrencyUnit.make("sat"),
  keysetId: KeysetId.make(KEYSET_HEX),
});

// 4 + 2 + 8: 14 sats available at the mint under test.
const sourceProofs = [
  proof(4, "src-a1"),
  proof(2, "src-a2"),
  proof(8, "src-b1"),
];

const outputsAlreadySigned = () =>
  new MintOperationError(11005, "outputs have already been signed before");

interface FakeWalletArgs {
  send?: (call: SendCall) => Promise<SendResponse>;
  /** NUT-07 state per proof secret; defaults to UNSPENT. */
  stateOf?: (secret: string) => "UNSPENT" | "PENDING" | "SPENT";
  checkStatesError?: unknown;
  restore?: () => Promise<{
    proofs: CashuProof[];
    lastCounterWithSignature?: number;
  }>;
}

interface SendCall {
  readonly amount: number;
  readonly secrets: ReadonlyArray<string>;
  readonly sendCounter: number;
  readonly keepCounter: number;
}

const makeWallet = (args: FakeWalletArgs) => {
  const sendCalls: SendCall[] = [];
  const restoreCalls: Array<{ start: number; count: number }> = [];
  const wallet = fakeWallet({
    keysetId: KEYSET_HEX,
    checkProofsStates: (proofs) =>
      args.checkStatesError !== undefined
        ? Promise.reject(args.checkStatesError)
        : Promise.resolve(
            proofs.map((entry) => ({
              Y: entry.secret,
              state: args.stateOf?.(entry.secret) ?? "UNSPENT",
              witness: null,
            })),
          ),
    send: (amount, proofs, _config, outputConfig) => {
      const call: SendCall = {
        amount: typeof amount === "number" ? amount : -1,
        secrets: proofs.map((entry) => entry.secret),
        sendCounter:
          outputConfig?.send.type === "deterministic"
            ? outputConfig.send.counter
            : -1,
        keepCounter:
          outputConfig?.keep?.type === "deterministic"
            ? outputConfig.keep.counter
            : -1,
      };
      sendCalls.push(call);
      return args.send
        ? args.send(call)
        : Promise.reject(new Error("send not stubbed"));
    },
    restore: (start, count) => {
      restoreCalls.push({ start, count });
      return args.restore
        ? args.restore()
        : Promise.reject(new Error("restore unavailable"));
    },
  });
  return { wallet, sendCalls, restoreCalls };
};

const makeHarness = (wallet: LoadedWallet) => {
  const inspector = recordingInspector();
  const layer = Send.DefaultWithoutDependencies.pipe(
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
      Send | ProofStore | OperationStore | KeyValueStore | WalletInstances
    >,
  ) => Effect.runPromiseExit(program.pipe(Effect.provide(layer)));
  return { run, events: inspector.events };
};

interface Seed {
  readonly mint: string;
  readonly proofs: ReadonlyArray<CashuProof>;
}

const sendAndInspect = (
  draft: SendDraft,
  seeds: ReadonlyArray<Seed> = [{ mint, proofs: sourceProofs }],
) =>
  Effect.gen(function* () {
    yield* Effect.forEach(seeds, (seed) => seedProofs(seed.mint, seed.proofs));
    const send = yield* Send;
    const kv = yield* KeyValueStore;
    const receipt = yield* Effect.either(send.send(draft));
    return {
      receipt,
      proofs: yield* (yield* ProofStore).loadAll,
      operations: yield* (yield* OperationStore).loadAll,
      counter: yield* kv.get(counterKey),
    };
  });

const stateOf = (
  proofs: ReadonlyArray<StoredProof>,
  secret: string,
): string | undefined => proofs.find((p) => p.secret === secret)?.state;

const allAvailable = (proofs: ReadonlyArray<StoredProof>): boolean =>
  proofs.every((p) => p.state === "available");

const draft = (amount: number, produceAs: "issued" | "pending" = "issued") =>
  new SendDraft({ mint, amount: SendAmount.make(amount), produceAs });

describe("Send.send", () => {
  it("swaps with disjoint counter blocks, books the transfer, change, and spent inputs", async () => {
    // keep mixes passthrough (a1) with one fresh change output (k1).
    const { wallet, sendCalls } = makeWallet({
      send: () =>
        Promise.resolve({
          keep: [proof(4, "src-a1"), proof(4, "k1")],
          send: [proof(4, "s1"), proof(1, "s2")],
        }),
    });
    const { run, events } = makeHarness(wallet);

    const exit = await run(
      sendAndInspect(draft(5), [
        { mint, proofs: sourceProofs },
        { mint: otherMint, proofs: [proof(16, "src-o1")] },
      ]),
    );
    assert(Exit.isSuccess(exit));
    const { receipt, proofs, operations, counter } = exit.value;

    assert(receipt._tag === "Right");
    expect(receipt.right.mint).toBe(mint);
    expect(receipt.right.unit).toBe("sat");
    expect(receipt.right.amount).toBe(5);
    expect(receipt.right.changeAmount).toBe(8);
    // 14 offered - 5 sent - 8 kept.
    expect(receipt.right.feePaid).toBe(1);
    expect(parseTokenText(receipt.right.tokenText)?.amount).toBe(5);

    expect(sendCalls).toEqual([
      {
        amount: 5,
        secrets: ["src-a1", "src-a2", "src-b1"],
        sendCounter: 1,
        keepCounter: 65,
      },
    ]);
    // Send block (64) fully burned + 1 fresh keep output.
    expect(counter).toBe("66");

    // The passthrough input, the fresh change, and the foreign-mint proof
    // are balance; the consumed inputs are spent; the sent proofs are out.
    expect(secretsOf(proofsIn(proofs, "available"))).toEqual([
      "k1",
      "src-a1",
      "src-o1",
    ]);
    expect(secretsOf(proofsIn(proofs, "spent"))).toEqual(["src-a2", "src-b1"]);
    const handedOut = proofsIn(proofs, "handedOut");
    expect(secretsOf(handedOut)).toEqual(["s1", "s2"]);
    expect(
      handedOut.every((p) => p.operationId === receipt.right.operationId),
    ).toBe(true);

    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({
      id: receipt.right.operationId,
      kind: "send",
      status: "issued",
      mint,
      amount: 5,
      tokenText: receipt.right.tokenText,
      error: null,
    });

    expect(events.map((event) => event._tag)).toEqual([
      "CounterAdvanced",
      "OperationChanged",
      "ProofsChanged",
      "ProofsChanged",
      "ProofsChanged",
      "OperationSucceeded",
    ]);
    expect(events[0]).toMatchObject({ from: 1, to: 66, reason: "used" });
    expect(events[1]).toMatchObject({
      kind: "send",
      from: null,
      to: "issued",
      reason: "send",
    });
    expect(events[2]).toMatchObject({
      from: null,
      to: "handedOut",
      count: 2,
      amount: 5,
      operationId: receipt.right.operationId,
      reason: "send",
    });
    expect(events[3]).toMatchObject({
      from: null,
      to: "available",
      count: 1,
      amount: 4,
      reason: "send-change",
    });
    expect(events[4]).toMatchObject({
      from: "available",
      to: "spent",
      count: 2,
      amount: 10,
      reason: "send-change",
    });
    expect(events[5]).toMatchObject({
      name: "send.send",
      params: { mint, amount: 5, produceAs: "issued" },
      result: { amount: 5, changeAmount: 8, feePaid: 1 },
    });
    // No key material: neither token text nor proof secrets in any event.
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain("cashu");
    expect(serialized).not.toContain("s1");
    expect(serialized).not.toContain("src-a1");
  });

  it("leaves a NUT-07 pending proof available but does not offer it", async () => {
    const { wallet, sendCalls } = makeWallet({
      stateOf: (secret) => (secret === "locked" ? "PENDING" : "UNSPENT"),
      send: () =>
        Promise.resolve({
          keep: [proof(8, "keep")],
          send: [proof(4, "out1"), proof(1, "out2")],
        }),
    });
    const { run, events } = makeHarness(wallet);

    const exit = await run(
      sendAndInspect(draft(5), [
        { mint, proofs: [...sourceProofs, proof(32, "locked")] },
      ]),
    );
    assert(Exit.isSuccess(exit));
    assert(exit.value.receipt._tag === "Right");
    expect(exit.value.receipt.right).toMatchObject({
      amount: 5,
      feePaid: 1,
      changeAmount: 8,
    });
    expect(sendCalls[0]?.secrets).toEqual(["src-a1", "src-a2", "src-b1"]);
    expect(stateOf(exit.value.proofs, "locked")).toBe("available");
    expect(JSON.stringify(events)).not.toContain("locked");
  });

  it("keeps every source proof if the swap fails after filtering pending proofs", async () => {
    const { wallet, sendCalls } = makeWallet({
      stateOf: (secret) => (secret === "src-a2" ? "PENDING" : "UNSPENT"),
      send: () =>
        Promise.reject(new MintOperationError(11002, "proofs are pending")),
    });
    const { run } = makeHarness(wallet);

    const exit = await run(sendAndInspect(draft(5)));
    assert(Exit.isSuccess(exit));
    assert(exit.value.receipt._tag === "Left");
    expect(sendCalls[0]?.secrets).toEqual(["src-a1", "src-b1"]);
    expect(allAvailable(exit.value.proofs)).toBe(true);
    expect(exit.value.operations).toEqual([]);
  });

  it("produces the send transfer in the drafted pending status", async () => {
    const { wallet } = makeWallet({
      send: () =>
        Promise.resolve({ keep: [], send: [proof(4, "s1"), proof(2, "s2")] }),
    });
    const { run } = makeHarness(wallet);

    const exit = await run(
      sendAndInspect(draft(6, "pending"), [
        { mint, proofs: [proof(4, "src-a1"), proof(2, "src-a2")] },
      ]),
    );
    assert(Exit.isSuccess(exit));
    expect(exit.value.receipt._tag).toBe("Right");
    // Exact spend: no change, every input spent, the sent proofs handed out.
    expect(exit.value.operations.map((op) => op.status)).toEqual(["pending"]);
    expect(proofsIn(exit.value.proofs, "available")).toEqual([]);
    expect(secretsOf(proofsIn(exit.value.proofs, "spent"))).toEqual([
      "src-a1",
      "src-a2",
    ]);
    expect(secretsOf(proofsIn(exit.value.proofs, "handedOut"))).toEqual([
      "s1",
      "s2",
    ]);
  });

  it("carries the sent proofs with full v2 keyset ids, which the token text alone loses", async () => {
    const v2KeysetId = "01" + "ab".repeat(32);
    const sent = [proof(4, "s1"), proof(2, "s2")].map((sentProof) => ({
      ...sentProof,
      id: v2KeysetId,
    }));
    const { wallet } = makeWallet({
      send: () => Promise.resolve({ keep: [], send: sent }),
    });
    const { run } = makeHarness(wallet);

    const exit = await run(sendAndInspect(draft(6, "pending")));
    assert(Exit.isSuccess(exit));
    const { receipt } = exit.value;
    assert(receipt._tag === "Right");

    expect(receipt.right.proofs).toMatchObject([
      { id: v2KeysetId, amount: 4, secret: "s1" },
      { id: v2KeysetId, amount: 2, secret: "s2" },
    ]);
    expect(decodeTokenText(receipt.right.tokenText)).toBeNull();
    expect(
      decodeTokenText(receipt.right.tokenText, [v2KeysetId])?.proofs,
    ).toEqual(receipt.right.proofs);
  });

  it("excludes NUT-07 spent proofs from the swap and marks them spent", async () => {
    const { wallet, sendCalls } = makeWallet({
      stateOf: (secret) =>
        secret === "src-a2" || secret === "src-z1" ? "SPENT" : "UNSPENT",
      send: () => Promise.resolve({ keep: [], send: [proof(3, "s1")] }),
    });
    const { run, events } = makeHarness(wallet);

    const exit = await run(
      sendAndInspect(draft(3), [
        {
          mint,
          proofs: [proof(4, "src-a1"), proof(2, "src-a2"), proof(3, "src-z1")],
        },
      ]),
    );
    assert(Exit.isSuccess(exit));
    const { receipt, proofs } = exit.value;

    assert(receipt._tag === "Right");
    // Only the unspent a1 proof was offered; available was 4, fee 4-3-0.
    expect(sendCalls[0]?.secrets).toEqual(["src-a1"]);
    expect(receipt.right.feePaid).toBe(1);
    expect(receipt.right.changeAmount).toBe(0);

    expect(secretsOf(proofsIn(proofs, "spent"))).toEqual([
      "src-a1",
      "src-a2",
      "src-z1",
    ]);
    expect(events[0]).toMatchObject({
      _tag: "ProofsChanged",
      from: "available",
      to: "spent",
      count: 2,
      amount: 5,
      reason: "send",
    });
  });

  it("keeps definitive spend knowledge even when the swap then fails", async () => {
    const { wallet } = makeWallet({
      stateOf: (secret) => (secret === "src-b1" ? "SPENT" : "UNSPENT"),
      send: () => Promise.reject(new TypeError("fetch failed")),
    });
    const { run } = makeHarness(wallet);

    const exit = await run(sendAndInspect(draft(5)));
    assert(Exit.isSuccess(exit));
    assert(exit.value.receipt._tag === "Left");
    expect(exit.value.receipt.left._tag).toBe("MintUnreachable");
    expect(stateOf(exit.value.proofs, "src-b1")).toBe("spent");
    expect(secretsOf(proofsIn(exit.value.proofs, "available"))).toEqual([
      "src-a1",
      "src-a2",
    ]);
  });

  it("fails with InsufficientFunds before calling the mint", async () => {
    const { wallet, sendCalls } = makeWallet({});
    const { run } = makeHarness(wallet);

    const exit = await run(sendAndInspect(draft(15)));
    assert(Exit.isSuccess(exit));
    assert(exit.value.receipt._tag === "Left");
    expect(exit.value.receipt.left).toMatchObject({
      _tag: "InsufficientFunds",
      required: 15,
      available: 14,
    });
    expect(sendCalls).toEqual([]);
    expect(allAvailable(exit.value.proofs)).toBe(true);
  });

  it("maps the mint's fee-inclusive shortfall to InsufficientFunds", async () => {
    const { wallet } = makeWallet({
      send: () =>
        Promise.reject(new Error("Not enough funds available for swap")),
    });
    const { run } = makeHarness(wallet);

    const exit = await run(sendAndInspect(draft(14)));
    assert(Exit.isSuccess(exit));
    assert(exit.value.receipt._tag === "Left");
    expect(exit.value.receipt.left).toMatchObject({
      _tag: "InsufficientFunds",
      required: 14,
      available: 14,
    });
    expect(allAvailable(exit.value.proofs)).toBe(true);
  });

  it("surfaces transient failures without touching the inventory", async () => {
    const { wallet } = makeWallet({
      send: () => Promise.reject(new TypeError("fetch failed")),
    });
    const { run, events } = makeHarness(wallet);

    const exit = await run(sendAndInspect(draft(5)));
    assert(Exit.isSuccess(exit));
    assert(exit.value.receipt._tag === "Left");
    expect(exit.value.receipt.left._tag).toBe("MintUnreachable");
    expect(allAvailable(exit.value.proofs)).toBe(true);
    expect(exit.value.operations).toEqual([]);
    expect(events.map((event) => event._tag)).toEqual(["OperationFailed"]);
  });

  it("classifies a NUT-07 check failure as MintUnreachable", async () => {
    const { wallet, sendCalls } = makeWallet({
      checkStatesError: new TypeError("fetch failed"),
    });
    const { run } = makeHarness(wallet);

    const exit = await run(sendAndInspect(draft(5)));
    assert(Exit.isSuccess(exit));
    assert(exit.value.receipt._tag === "Left");
    expect(exit.value.receipt.left._tag).toBe("MintUnreachable");
    expect(sendCalls).toEqual([]);
  });

  it("surfaces a definitive rejection as MintRejected and leaves proofs intact", async () => {
    const { wallet } = makeWallet({
      send: () =>
        Promise.reject(new MintOperationError(20003, "keyset inactive")),
    });
    const { run } = makeHarness(wallet);

    const exit = await run(sendAndInspect(draft(5)));
    assert(Exit.isSuccess(exit));
    assert(exit.value.receipt._tag === "Left");
    expect(exit.value.receipt.left).toMatchObject({
      _tag: "MintRejected",
      code: 20003,
    });
    expect(allAvailable(exit.value.proofs)).toBe(true);
  });

  it.each([
    outputsAlreadySigned(),
    new MintOperationError(11008, "Duplicate outputs"),
    new Error("Duplicate outputs"),
  ])(
    "recovers a stale counter via NUT-09 restore and retries: %s",
    async (collision) => {
      const { wallet, sendCalls, restoreCalls } = makeWallet({
        send: (call) =>
          call.sendCounter < 40
            ? Promise.reject(collision)
            : Promise.resolve({
                keep: [proof(9, "k1")],
                send: [proof(4, "s1")],
              }),
        restore: () =>
          Promise.resolve({ proofs: [], lastCounterWithSignature: 39 }),
      });
      const { run, events } = makeHarness(wallet);

      const exit = await run(sendAndInspect(draft(4)));
      assert(Exit.isSuccess(exit));
      expect(exit.value.receipt._tag).toBe("Right");
      expect(sendCalls.map((call) => call.sendCounter)).toEqual([1, 40]);
      expect(sendCalls[1]?.keepCounter).toBe(104);
      expect(restoreCalls).toEqual([{ start: 1, count: 100 }]);
      expect(exit.value.counter).toBe("105"); // 40 + 64 + 1 fresh keep output

      const counterEvents = events.filter(
        (event) => event._tag === "CounterAdvanced",
      );
      expect(counterEvents).toEqual([
        expect.objectContaining({
          from: 1,
          to: 40,
          reason: "collision-recovery",
        }),
        expect.objectContaining({ from: 40, to: 105, reason: "used" }),
      ]);
    },
  );

  it("bounds duplicate-output retries and preserves the inventory on rejection", async () => {
    const { wallet, sendCalls, restoreCalls } = makeWallet({
      send: () =>
        Promise.reject(new MintOperationError(11008, "Duplicate outputs")),
      restore: () => Promise.resolve({ proofs: [] }),
    });
    const { run } = makeHarness(wallet);
    const exit = await run(sendAndInspect(draft(4)));
    assert(Exit.isSuccess(exit));
    assert(exit.value.receipt._tag === "Left");
    expect(exit.value.receipt.left).toMatchObject({
      _tag: "MintRejected",
      code: 11008,
    });
    expect(sendCalls.map((call) => call.sendCounter)).toEqual([
      1, 129, 257, 385, 513,
    ]);
    expect(restoreCalls).toHaveLength(5);
    expect(allAvailable(exit.value.proofs)).toBe(true);
  });

  it("starts the swap from the persisted counter", async () => {
    const { wallet, sendCalls } = makeWallet({
      send: () => Promise.resolve({ keep: [], send: [proof(4, "s1")] }),
    });
    const { run } = makeHarness(wallet);

    const exit = await run(
      Effect.gen(function* () {
        const kv = yield* KeyValueStore;
        yield* kv.set(counterKey, "7");
        yield* seedProofs(mint, [proof(4, "src-a1")]);
        const send = yield* Send;
        yield* send.send(draft(4));
        return yield* kv.get(counterKey);
      }),
    );
    expect(exit).toEqual(Exit.succeed("71")); // 7 + 64 send block, no change
    expect(sendCalls[0]).toMatchObject({ sendCounter: 7, keepCounter: 71 });
  });
});
