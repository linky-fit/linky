import type {
  MeltProofsResponse,
  MeltQuoteBolt11Response,
  MeltQuoteState,
  Proof as CashuProof,
  SendResponse,
} from "@cashu/cashu-ts";
import { Amount, MintOperationError } from "@cashu/cashu-ts";
import { Effect, Exit, Layer, TestClock, TestContext } from "effect";
import {
  Bolt11Invoice,
  CurrencyUnit,
  KeysetId,
  QuoteId,
  MintUrl,
} from "../domain/primitives";
import {
  DERIVATION_GAP_LIMIT,
  deterministicCounterKey,
} from "../internal/counters";
import { WalletInstances } from "../mint/internal/WalletInstances";
import type { LoadedWallet } from "../mint/internal/WalletInstances";
import { KeyValueStore } from "../ports/KeyValueStore";
import { OperationStore } from "../ports/OperationStore";
import type { StoredOperation } from "../ports/OperationStore";
import { ProofStore } from "../ports/ProofStore";
import type { StoredProof } from "../ports/ProofStore";
import { runOnTestClock } from "../testing/clock";
import { fakeWallet, KEYSET_HEX, proof } from "../testing/fakeWallet";
import { recordingInspector } from "../testing/inspector";
import {
  amountIn,
  proofsIn,
  secretsOf,
  seedProofs,
} from "../testing/inventory";
import { freshStorage } from "../testing/storage";
import type { Storage } from "../testing/storage";
import { MeltDraft } from "./domain";
import { Melt } from "./Melt";

const mint = MintUrl.make("https://mint.example");
const counterKey = deterministicCounterKey({
  mint,
  unit: CurrencyUnit.make("sat"),
  keysetId: KeysetId.make(KEYSET_HEX),
});
const invoice = Bolt11Invoice.make("lnbc1fakeinvoice");
const draft = new MeltDraft({ mint, invoice });

// Batch A (4+2) and batch B (8): 14 sats available at the mint under test.
const proofsA = [proof(4, "src-a1"), proof(2, "src-a2")];
const proofsB = [proof(8, "src-b1")];

const LEGACY_PENDING_MELT_KEY_PREFIX = "linkshu.pendingMelt.";

const futureExpiry = () => Math.floor(Date.now() / 1000) + 600;

const quoteResponse = (
  over?: Partial<MeltQuoteBolt11Response>,
): MeltQuoteBolt11Response => ({
  quote: "quote-1",
  amount: Amount.from(10),
  unit: "sat",
  state: "UNPAID",
  expiry: futureExpiry(),
  request: invoice,
  fee_reserve: Amount.from(2),
  payment_preimage: null,
  ...over,
});

const meltResponse = (
  state: MeltQuoteState,
  change: CashuProof[],
): MeltProofsResponse<MeltQuoteBolt11Response> => ({
  quote: quoteResponse({
    state,
    payment_preimage: state === "PAID" ? "00" : null,
  }),
  change,
  outputData: [],
});

// A swap covering quote 10 + reserve 2 + 1 input fee: melt inputs sum to 13.
const swappedThirteen = (): SendResponse => ({
  keep: [proof(1, "k1")],
  send: [proof(8, "m1"), proof(4, "m2"), proof(1, "m3")],
});

const outputsAlreadySigned = () =>
  new MintOperationError(11005, "outputs have already been signed before");

interface SendCall {
  readonly amount: number;
  readonly secrets: ReadonlyArray<string>;
  readonly includeFees: boolean;
  readonly sendCounter: number;
  readonly keepCounter: number;
}

interface MeltCall {
  readonly quoteId: string;
  readonly secrets: ReadonlyArray<string>;
  readonly counter: number;
}

interface FakeWalletArgs {
  quote?: () => Promise<MeltQuoteBolt11Response>;
  send?: (call: SendCall) => Promise<SendResponse>;
  melt?: (
    call: MeltCall,
  ) => Promise<MeltProofsResponse<MeltQuoteBolt11Response>>;
  checkQuote?: () => Promise<MeltQuoteBolt11Response>;
  /** NUT-07 state per proof secret; defaults to UNSPENT. */
  stateOf?: (secret: string) => "UNSPENT" | "PENDING" | "SPENT";
  restore?: (
    start: number,
    count: number,
  ) => Promise<{ proofs: CashuProof[]; lastCounterWithSignature?: number }>;
  /** NUT-09 walk collision recovery runs from the colliding counter. */
  probe?: () => Promise<{
    proofs: CashuProof[];
    lastCounterWithSignature?: number;
  }>;
}

const makeWallet = (args: FakeWalletArgs) => {
  const sendCalls: SendCall[] = [];
  const meltCalls: MeltCall[] = [];
  const checkQuoteCalls: string[] = [];
  const restoreCalls: Array<{ start: number; count: number }> = [];
  const probeCalls: Array<{ start: number; gapLimit: number }> = [];
  const wallet = fakeWallet({
    keysetId: KEYSET_HEX,
    checkProofsStates: (proofs) =>
      Promise.resolve(
        proofs.map((entry) => ({
          Y: entry.secret,
          state: args.stateOf?.(entry.secret) ?? "UNSPENT",
          witness: null,
        })),
      ),
    send: (amount, proofs, config, outputConfig) => {
      const call: SendCall = {
        amount: typeof amount === "number" ? amount : -1,
        secrets: proofs.map((entry) => entry.secret),
        includeFees: config?.includeFees === true,
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
        ? args.restore(start, count)
        : Promise.reject(new Error("restore unavailable"));
    },
    batchRestore: (gapLimit = 0, _batchSize, start = 0) => {
      probeCalls.push({ start, gapLimit });
      return args.probe
        ? args.probe()
        : Promise.reject(new Error("restore unavailable"));
    },
    createMeltQuoteBolt11: () =>
      args.quote ? args.quote() : Promise.resolve(quoteResponse()),
    checkMeltQuoteBolt11: (quote) => {
      checkQuoteCalls.push(typeof quote === "string" ? quote : quote.quote);
      return args.checkQuote
        ? args.checkQuote()
        : Promise.reject(new Error("checkMeltQuote not stubbed"));
    },
    meltProofsBolt11: (meltQuote, proofsToSend, _config, outputType) => {
      const call: MeltCall = {
        quoteId: meltQuote.quote,
        secrets: proofsToSend.map((entry) => entry.secret),
        counter: outputType?.type === "deterministic" ? outputType.counter : -1,
      };
      meltCalls.push(call);
      return args.melt
        ? args.melt(call)
        : Promise.reject(new Error("melt not stubbed"));
    },
  });
  return {
    wallet,
    sendCalls,
    meltCalls,
    checkQuoteCalls,
    restoreCalls,
    probeCalls,
  };
};

/** One runtime over the given storage — a second one models a restart. */
const makeHarness = (
  wallet: LoadedWallet,
  storage: Storage = freshStorage(),
) => {
  const inspector = recordingInspector();
  const layer = Melt.DefaultWithoutDependencies.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        Layer.succeed(
          WalletInstances,
          WalletInstances.make({ get: () => Effect.succeed(wallet) }),
        ),
        Layer.succeed(KeyValueStore, storage.kv),
        Layer.succeed(ProofStore, storage.proofs),
        Layer.succeed(OperationStore, storage.operations),
        inspector.layer,
      ),
    ),
  );
  const run = <A, E>(
    program: Effect.Effect<
      A,
      E,
      Melt | ProofStore | OperationStore | KeyValueStore | WalletInstances
    >,
  ) => Effect.runPromiseExit(program.pipe(Effect.provide(layer)));
  return { run, events: inspector.events };
};

const meltAndInspect = (seeds: ReadonlyArray<ReadonlyArray<CashuProof>>) =>
  Effect.gen(function* () {
    yield* Effect.forEach(seeds, (proofs) => seedProofs(mint, proofs));
    const melt = yield* Melt;
    const kv = yield* KeyValueStore;
    const receipt = yield* Effect.either(melt.melt(draft));
    return {
      receipt,
      proofs: yield* (yield* ProofStore).loadAll,
      operations: yield* (yield* OperationStore).loadAll,
      counter: yield* kv.get(counterKey),
    };
  });

const storedProofs = (storage: Storage) =>
  Effect.runPromise(storage.proofs.loadAll);

const meltOperations = (storage: Storage) =>
  Effect.runPromise(storage.operations.loadAll).then((operations) =>
    operations.filter((operation) => operation.kind === "melt"),
  );

const pendingMelts = (storage: Storage) =>
  meltOperations(storage).then((operations) =>
    operations.filter((operation) => operation.status === "pending"),
  );

const onlyMelt = (
  operations: ReadonlyArray<StoredOperation>,
): StoredOperation => {
  const melts = operations.filter((operation) => operation.kind === "melt");
  expect(melts).toHaveLength(1);
  const [only] = melts;
  assert(only !== undefined);
  return only;
};

const availableAmounts = (proofs: ReadonlyArray<StoredProof>) =>
  proofsIn(proofs, "available")
    .map((proof) => proof.amount)
    .sort((a, b) => a - b);

const resumeAndInspect = Effect.gen(function* () {
  const results = yield* (yield* Melt).resumePending;
  return {
    results,
    proofs: yield* (yield* ProofStore).loadAll,
    operations: yield* (yield* OperationStore).loadAll,
  };
});

/**
 * A melt whose request left but whose outcome the process never learned:
 * the response and the follow-up quote check both fail, so the runtime ends
 * with `PaymentPending`, the inputs `held`, and a pending `melt` operation.
 */
const interruptMelt = async (storage: Storage) => {
  const { wallet, meltCalls } = makeWallet({
    send: () => Promise.resolve(swappedThirteen()),
    melt: () => Promise.reject(new TypeError("fetch failed")),
    checkQuote: () => Promise.reject(new TypeError("fetch failed")),
  });
  const exit = await makeHarness(wallet, storage).run(
    meltAndInspect([proofsA, proofsB]),
  );
  assert(Exit.isSuccess(exit));
  assert(exit.value.receipt._tag === "Left");
  expect(exit.value.receipt.left._tag).toBe("PaymentPending");
  expect(meltCalls).toHaveLength(1);
  return exit.value;
};

describe("Melt.quote", () => {
  it("prices the payment without touching stored proofs", async () => {
    const { wallet, sendCalls } = makeWallet({});
    const { run, events } = makeHarness(wallet);

    const exit = await run(
      Effect.gen(function* () {
        yield* seedProofs(mint, proofsA);
        const melt = yield* Melt;
        const quoted = yield* melt.quote(draft);
        return { quoted, proofs: yield* (yield* ProofStore).loadAll };
      }),
    );
    assert(Exit.isSuccess(exit));
    expect(exit.value.quoted).toMatchObject({
      quoteId: "quote-1",
      mint,
      amount: 10,
      feeReserve: 2,
    });
    expect(proofsIn(exit.value.proofs, "available")).toHaveLength(2);
    expect(sendCalls).toEqual([]);
    // No invoice text in any event.
    expect(JSON.stringify(events)).not.toContain("lnbc");
  });

  it("rejects a malformed melt quote as MintRejected", async () => {
    const { wallet } = makeWallet({
      quote: () => Promise.resolve(quoteResponse({ amount: Amount.from(0) })),
    });
    const { run } = makeHarness(wallet);

    const exit = await run(
      Effect.flatMap(Melt, (melt) => Effect.flip(melt.quote(draft))),
    );
    assert(Exit.isSuccess(exit));
    expect(exit.value).toMatchObject({ _tag: "MintRejected", mint });
  });
});

describe("Melt.melt", () => {
  it("pays the invoice with exact fee, change, and blank-output accounting", async () => {
    const storage = freshStorage();
    const { wallet, sendCalls, meltCalls } = makeWallet({
      send: () => Promise.resolve(swappedThirteen()),
      melt: async () => {
        // The operation and its held inputs are durable before the request
        // reaches the mint.
        const pending = onlyMelt(await meltOperations(storage));
        expect(pending).toMatchObject({
          status: "pending",
          quoteId: "quote-1",
          amount: 10,
          feeReserve: 2,
          inputsTotal: 13,
          counter: 66,
        });
        const held = proofsIn(await storedProofs(storage), "held");
        expect(secretsOf(held)).toEqual(["m1", "m2", "m3"]);
        expect(held.every((proof) => proof.operationId === pending.id)).toBe(
          true,
        );
        return meltResponse("PAID", [proof(1, "chg")]);
      },
    });
    const { run, events } = makeHarness(wallet, storage);

    const exit = await run(meltAndInspect([proofsA, proofsB]));
    assert(Exit.isSuccess(exit));
    const { receipt, proofs, operations, counter } = exit.value;
    const operation = onlyMelt(operations);
    expect(operation.status).toBe("paid");

    assert(receipt._tag === "Right");
    expect(receipt.right).toMatchObject({
      mint,
      quoteId: "quote-1",
      paidAmount: 10,
      feeReserve: 2,
      // 13 melt inputs - 10 paid - 1 change.
      feePaid: 2,
      changeAmount: 1,
    });

    // The swap requested amount + feeReserve, fee-inclusive, with disjoint
    // deterministic blocks; the melt derived its blanks right after.
    expect(sendCalls).toEqual([
      {
        amount: 12,
        secrets: ["src-a1", "src-a2", "src-b1"],
        includeFees: true,
        sendCounter: 1,
        keepCounter: 65,
      },
    ]);
    // excess 13 - 10 = 3 -> ceil(log2(3)) = 2 blank slots from counter 66.
    expect(meltCalls).toEqual([
      { quoteId: "quote-1", secrets: ["m1", "m2", "m3"], counter: 66 },
    ]);
    expect(counter).toBe("68");

    // Sources and melt inputs are spent; the swap remainder and the melt
    // change are balance.
    expect(secretsOf(proofsIn(proofs, "available"))).toEqual(["chg", "k1"]);
    expect(secretsOf(proofsIn(proofs, "spent"))).toEqual([
      "m1",
      "m2",
      "m3",
      "src-a1",
      "src-a2",
      "src-b1",
    ]);
    expect(proofsIn(proofs, "held")).toHaveLength(0);

    expect(events.map((event) => event._tag)).toEqual([
      "QuoteStateChanged",
      "CounterAdvanced",
      "OperationChanged",
      "ProofsChanged",
      "ProofsChanged",
      "ProofsChanged",
      "CounterAdvanced",
      "QuoteStateChanged",
      "ProofsChanged",
      "ProofsChanged",
      "OperationChanged",
      "OperationSucceeded",
    ]);
    expect(events[0]).toMatchObject({ flow: "melt", state: "UNPAID" });
    expect(events[1]).toMatchObject({ from: 1, to: 66, reason: "used" });
    expect(events[2]).toMatchObject({
      kind: "melt",
      from: null,
      to: "pending",
      operationId: operation.id,
    });
    expect(events[3]).toMatchObject({
      to: "held",
      amount: 13,
      operationId: operation.id,
      reason: "melt",
    });
    expect(events[4]).toMatchObject({ to: "available", reason: "melt-keep" });
    expect(events[5]).toMatchObject({
      from: "available",
      to: "spent",
      amount: 14,
      reason: "melt-keep",
    });
    expect(events[6]).toMatchObject({ from: 66, to: 68, reason: "used" });
    expect(events[7]).toMatchObject({ flow: "melt", state: "PAID" });
    expect(events[8]).toMatchObject({ to: "available", reason: "melt-change" });
    expect(events[9]).toMatchObject({
      from: "held",
      to: "spent",
      reason: "melt-paid",
    });
    expect(events[10]).toMatchObject({ from: "pending", to: "paid" });
    expect(events[11]).toMatchObject({
      name: "melt.melt",
      params: { mint },
      result: { paidAmount: 10, feePaid: 2, changeAmount: 1 },
    });
    // No key material: no token text, proof secrets, or invoice in events.
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain("cashu");
    expect(serialized).not.toContain("src-a1");
    expect(serialized).not.toContain("lnbc");
  });

  it("pays with unspent proofs and leaves pending ones stored", async () => {
    const mixed = [...proofsA, proof(32, "locked")];
    const { wallet, sendCalls } = makeWallet({
      stateOf: (secret) => (secret === "locked" ? "PENDING" : "UNSPENT"),
      send: () => Promise.resolve(swappedThirteen()),
      melt: () => Promise.resolve(meltResponse("PAID", [proof(1, "change")])),
    });
    const { run, events } = makeHarness(wallet);
    const exit = await run(meltAndInspect([mixed, proofsB]));
    assert(Exit.isSuccess(exit));
    assert(exit.value.receipt._tag === "Right");
    expect(sendCalls[0]?.secrets).toEqual(["src-a1", "src-a2", "src-b1"]);
    expect(availableAmounts(exit.value.proofs)).toEqual([1, 1, 32]);
    expect(secretsOf(proofsIn(exit.value.proofs, "available"))).toContain(
      "locked",
    );
    expect(JSON.stringify(events)).not.toContain("locked");
  });

  it("does not swap or touch anything when only pending funds cover the payment", async () => {
    const { wallet, sendCalls, meltCalls } = makeWallet({
      stateOf: (secret) => (secret === "src-a1" ? "PENDING" : "UNSPENT"),
    });
    const { run } = makeHarness(wallet);
    const exit = await run(meltAndInspect([proofsA, proofsB]));
    assert(Exit.isSuccess(exit));
    assert(exit.value.receipt._tag === "Left");
    expect(exit.value.receipt.left).toMatchObject({
      _tag: "InsufficientFunds",
      available: 10,
    });
    expect(sendCalls).toEqual([]);
    expect(meltCalls).toEqual([]);
    expect(secretsOf(proofsIn(exit.value.proofs, "available"))).toEqual([
      "src-a1",
      "src-a2",
      "src-b1",
    ]);
    expect(exit.value.operations).toEqual([]);
  });

  it("fails with InsufficientFunds against amount + feeReserve before swapping", async () => {
    const { wallet, sendCalls } = makeWallet({});
    const { run } = makeHarness(wallet);

    const exit = await run(meltAndInspect([proofsB]));
    assert(Exit.isSuccess(exit));
    assert(exit.value.receipt._tag === "Left");
    expect(exit.value.receipt.left).toMatchObject({
      _tag: "InsufficientFunds",
      required: 12,
      available: 8,
    });
    expect(sendCalls).toEqual([]);
    expect(
      exit.value.proofs.every((proof) => proof.state === "available"),
    ).toBe(true);
    expect(exit.value.operations).toEqual([]);
  });

  it("fails with QuoteExpired without touching any proof", async () => {
    const { wallet, sendCalls, meltCalls } = makeWallet({
      quote: () => Promise.resolve(quoteResponse({ expiry: 1000 })),
    });
    const { run } = makeHarness(wallet);

    const exit = await run(meltAndInspect([proofsA, proofsB]));
    assert(Exit.isSuccess(exit));
    assert(exit.value.receipt._tag === "Left");
    expect(exit.value.receipt.left).toMatchObject({
      _tag: "QuoteExpired",
      quoteId: "quote-1",
      mint,
    });
    expect(sendCalls).toEqual([]);
    expect(meltCalls).toEqual([]);
    expect(
      exit.value.proofs.every((proof) => proof.state === "available"),
    ).toBe(true);
    expect(exit.value.operations).toEqual([]);
  });

  it("recovers a blank-output counter collision via NUT-09 and retries", async () => {
    const { wallet, meltCalls, probeCalls } = makeWallet({
      send: () => Promise.resolve(swappedThirteen()),
      melt: (call) =>
        call.counter < 100
          ? Promise.reject(outputsAlreadySigned())
          : Promise.resolve(meltResponse("PAID", [proof(1, "chg")])),
      probe: () =>
        Promise.resolve({ proofs: [], lastCounterWithSignature: 99 }),
    });
    const { run } = makeHarness(wallet);

    const exit = await run(meltAndInspect([proofsA, proofsB]));
    assert(Exit.isSuccess(exit));
    expect(exit.value.receipt._tag).toBe("Right");
    expect(meltCalls.map((call) => call.counter)).toEqual([66, 100]);
    expect(probeCalls).toEqual([{ start: 66, gapLimit: DERIVATION_GAP_LIMIT }]);
    expect(exit.value.counter).toBe("102"); // 100 + 2 blank slots
    // The operation remembers the slot of the attempt that went through.
    expect(onlyMelt(exit.value.operations)).toMatchObject({
      status: "paid",
      counter: 100,
    });
  });

  it("returns the held inputs to balance on a definitive rejection", async () => {
    const { wallet } = makeWallet({
      send: () => Promise.resolve(swappedThirteen()),
      melt: () =>
        Promise.reject(new MintOperationError(20003, "unable to pay invoice")),
    });
    const { run } = makeHarness(wallet);

    const exit = await run(meltAndInspect([proofsA, proofsB]));
    assert(Exit.isSuccess(exit));
    const { receipt, proofs, operations } = exit.value;
    assert(receipt._tag === "Left");
    expect(receipt.left).toMatchObject({ _tag: "MintRejected", code: 20003 });

    // Nothing lost: the swap remainder and the released inputs are balance.
    const available = proofsIn(proofs, "available");
    expect(secretsOf(available)).toEqual(["k1", "m1", "m2", "m3"]);
    expect(available.every((proof) => proof.operationId === null)).toBe(true);
    expect(proofsIn(proofs, "held")).toHaveLength(0);
    const operation = onlyMelt(operations);
    expect(operation.status).toBe("failed");
    expect(JSON.parse(operation.error ?? "")).toMatchObject({
      _tag: "MintRejected",
      code: 20003,
    });
  });

  it("treats an UNPAID melt response as a failed payment and releases the inputs", async () => {
    const { wallet } = makeWallet({
      send: () => Promise.resolve(swappedThirteen()),
      melt: () => Promise.resolve(meltResponse("UNPAID", [])),
    });
    const { run } = makeHarness(wallet);

    const exit = await run(meltAndInspect([proofsA, proofsB]));
    assert(Exit.isSuccess(exit));
    assert(exit.value.receipt._tag === "Left");
    expect(exit.value.receipt.left).toMatchObject({
      _tag: "PaymentFailed",
      quoteId: "quote-1",
    });
    expect(amountIn(exit.value.proofs, "available")).toBe(14);
    expect(proofsIn(exit.value.proofs, "held")).toHaveLength(0);
    expect(onlyMelt(exit.value.operations).status).toBe("unpaid");
  });

  it("finishes a PENDING payment once the quote turns PAID, reclaiming change", async () => {
    const { wallet, restoreCalls } = makeWallet({
      send: () => Promise.resolve(swappedThirteen()),
      melt: () => Promise.resolve(meltResponse("PENDING", [])),
      checkQuote: () => Promise.resolve(quoteResponse({ state: "PAID" })),
      restore: () => Promise.resolve({ proofs: [proof(1, "chg")] }),
    });
    const { run } = makeHarness(wallet);

    const exit = await run(meltAndInspect([proofsA, proofsB]));
    assert(Exit.isSuccess(exit));
    const { receipt, proofs, operations } = exit.value;
    assert(receipt._tag === "Right");
    expect(receipt.right).toMatchObject({ feePaid: 2, changeAmount: 1 });
    // The change came from re-deriving the melt's own blank range.
    expect(restoreCalls).toEqual([{ start: 66, count: 2 }]);
    expect(proofsIn(proofs, "held")).toHaveLength(0);
    expect(onlyMelt(operations).status).toBe("paid");
  });

  it("hands a payment that stays pending to resume, inputs held under the operation", async () => {
    const storage = freshStorage();
    const { wallet } = makeWallet({
      send: () => Promise.resolve(swappedThirteen()),
      melt: () => Promise.resolve(meltResponse("PENDING", [])),
      checkQuote: () => Promise.resolve(quoteResponse({ state: "PENDING" })),
    });
    const { run } = makeHarness(wallet, storage);

    const exit = await run(
      Effect.gen(function* () {
        // Timestamps are positive unix seconds; the TestClock starts at 0.
        yield* TestClock.adjust("1000 seconds");
        return yield* runOnTestClock(
          meltAndInspect([proofsA, proofsB]),
          "500 millis",
        );
      }).pipe(Effect.provide(TestContext.TestContext)),
    );
    assert(Exit.isSuccess(exit));
    assert(exit.value.receipt._tag === "Left");
    // Neither balance nor destroyed: the operation lets `resumePending`
    // settle it.
    const operation = onlyMelt(exit.value.operations);
    expect(operation).toMatchObject({ status: "pending", counter: 66 });
    const held = proofsIn(exit.value.proofs, "held");
    expect(amountIn(exit.value.proofs, "held")).toBe(13);
    expect(held.every((proof) => proof.operationId === operation.id)).toBe(
      true,
    );
    expect(exit.value.receipt.left).toMatchObject({
      _tag: "PaymentPending",
      mint,
      quoteId: "quote-1",
      operationId: operation.id,
      amount: 10,
    });
  });

  it("reclaims a lost melt response when the quote reports PAID", async () => {
    const { wallet, restoreCalls } = makeWallet({
      send: () => Promise.resolve(swappedThirteen()),
      melt: () => Promise.reject(new TypeError("fetch failed")),
      checkQuote: () => Promise.resolve(quoteResponse({ state: "PAID" })),
      restore: () => Promise.resolve({ proofs: [proof(1, "chg")] }),
    });
    const { run } = makeHarness(wallet);

    const exit = await run(meltAndInspect([proofsA, proofsB]));
    assert(Exit.isSuccess(exit));
    const { receipt, proofs, operations } = exit.value;
    assert(receipt._tag === "Right");
    expect(receipt.right).toMatchObject({ paidAmount: 10, changeAmount: 1 });
    expect(restoreCalls).toEqual([{ start: 66, count: 2 }]);
    expect(proofsIn(proofs, "held")).toHaveLength(0);
    expect(onlyMelt(operations).status).toBe("paid");
  });

  it("keeps the inputs held under the operation when a lost response cannot be resolved", async () => {
    const storage = freshStorage();
    const { proofs } = await interruptMelt(storage);
    expect(proofsIn(proofs, "held")).toHaveLength(3);
    expect(await pendingMelts(storage)).toHaveLength(1);
  });

  it("releases the inputs when the quote check after a lost response says UNPAID", async () => {
    const storage = freshStorage();
    const { wallet } = makeWallet({
      send: () => Promise.resolve(swappedThirteen()),
      melt: () => Promise.reject(new TypeError("fetch failed")),
      checkQuote: () => Promise.resolve(quoteResponse({ state: "UNPAID" })),
    });
    const exit = await makeHarness(wallet, storage).run(
      meltAndInspect([proofsA, proofsB]),
    );
    assert(Exit.isSuccess(exit));
    assert(exit.value.receipt._tag === "Left");
    expect(exit.value.receipt.left._tag).toBe("PaymentFailed");
    expect(amountIn(exit.value.proofs, "available")).toBe(14);
    expect(await pendingMelts(storage)).toEqual([]);
    expect(onlyMelt(exit.value.operations).status).toBe("unpaid");
  });

  it("excludes NUT-07 spent proofs and marks them before melting", async () => {
    const { wallet, sendCalls } = makeWallet({
      stateOf: (secret) => (secret === "src-z1" ? "SPENT" : "UNSPENT"),
      send: () => Promise.resolve(swappedThirteen()),
      melt: () => Promise.resolve(meltResponse("PAID", [proof(1, "chg")])),
    });
    const { run, events } = makeHarness(wallet);

    const exit = await run(
      meltAndInspect([proofsA, proofsB, [proof(3, "src-z1")]]),
    );
    assert(Exit.isSuccess(exit));
    expect(exit.value.receipt._tag).toBe("Right");
    expect(sendCalls[0]?.secrets).toEqual(["src-a1", "src-a2", "src-b1"]);

    const marked = exit.value.proofs.find((proof) => proof.secret === "src-z1");
    expect(marked).toMatchObject({ state: "spent", operationId: null });
    expect(events).toContainEqual(
      expect.objectContaining({
        _tag: "ProofsChanged",
        from: "available",
        to: "spent",
        amount: 3,
        reason: "melt",
      }),
    );
  });
});

describe("Melt.resumePending", () => {
  it("finishes a paid melt on a fresh runtime, reclaiming change from the recorded blank slots", async () => {
    const storage = freshStorage();
    await interruptMelt(storage);

    const resuming = makeWallet({
      checkQuote: () => Promise.resolve(quoteResponse({ state: "PAID" })),
      restore: () => Promise.resolve({ proofs: [proof(1, "chg")] }),
    });
    const { run, events } = makeHarness(resuming.wallet, storage);
    const exit = await run(resumeAndInspect);
    assert(Exit.isSuccess(exit));

    const { results, proofs, operations } = exit.value;
    const operation = onlyMelt(operations);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      quoteId: "quote-1",
      mint,
      operationId: operation.id,
      amount: 10,
      status: "paid",
      receipt: { paidAmount: 10, feePaid: 2, changeAmount: 1 },
    });
    expect(resuming.restoreCalls).toEqual([{ start: 66, count: 2 }]);
    expect(resuming.meltCalls).toEqual([]);
    // The swap remainder and the change are balance; the inputs are gone.
    expect(secretsOf(proofsIn(proofs, "available"))).toEqual(["chg", "k1"]);
    expect(proofsIn(proofs, "held")).toHaveLength(0);
    expect(operation.status).toBe("paid");

    expect(events.map((event) => event._tag)).toEqual([
      "QuoteStateChanged",
      "ProofsChanged",
      "ProofsChanged",
      "OperationChanged",
      "OperationSucceeded",
      "OperationSucceeded",
    ]);
    expect(events[3]).toMatchObject({ from: "pending", to: "paid" });
    expect(events[4]).toMatchObject({
      name: "melt.resume",
      params: { mint, quoteId: "quote-1", operationId: operation.id },
    });
    expect(events[5]).toMatchObject({ name: "melt.resumePending" });
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain("cashu");
    expect(serialized).not.toContain("lnbc");
  });

  it("returns the inputs to balance when the mint reports UNPAID", async () => {
    const storage = freshStorage();
    await interruptMelt(storage);

    const resuming = makeWallet({
      checkQuote: () => Promise.resolve(quoteResponse({ state: "UNPAID" })),
    });
    const exit = await makeHarness(resuming.wallet, storage).run(
      resumeAndInspect,
    );
    assert(Exit.isSuccess(exit));
    expect(exit.value.results[0]).toMatchObject({
      status: "unpaid",
      receipt: null,
    });
    expect(resuming.restoreCalls).toEqual([]);
    expect(secretsOf(proofsIn(exit.value.proofs, "available"))).toEqual([
      "k1",
      "m1",
      "m2",
      "m3",
    ]);
    expect(proofsIn(exit.value.proofs, "held")).toHaveLength(0);
    expect(onlyMelt(exit.value.operations).status).toBe("unpaid");
  });

  it("leaves a PENDING payment and its held inputs untouched", async () => {
    const storage = freshStorage();
    await interruptMelt(storage);

    const resuming = makeWallet({
      checkQuote: () => Promise.resolve(quoteResponse({ state: "PENDING" })),
    });
    const exit = await makeHarness(resuming.wallet, storage).run(
      resumeAndInspect,
    );
    assert(Exit.isSuccess(exit));
    expect(exit.value.results[0]).toMatchObject({ status: "pending" });
    expect(proofsIn(exit.value.proofs, "held")).toHaveLength(3);
    expect(onlyMelt(exit.value.operations).status).toBe("pending");
  });

  it("keeps the operation when the mint gives no answer, even past the quote expiry", async () => {
    const storage = freshStorage();
    await interruptMelt(storage);

    const resuming = makeWallet({
      checkQuote: () => Promise.reject(new TypeError("fetch failed")),
    });
    const { run, events } = makeHarness(resuming.wallet, storage);
    const exit = await run(
      Effect.gen(function* () {
        yield* TestClock.adjust("48 hours");
        return yield* resumeAndInspect;
      }).pipe(Effect.provide(TestContext.TestContext)),
    );
    assert(Exit.isSuccess(exit));
    expect(exit.value.results[0]).toMatchObject({ status: "unresolved" });
    expect(proofsIn(exit.value.proofs, "held")).toHaveLength(3);
    expect(onlyMelt(exit.value.operations).status).toBe("pending");
    expect(events).toContainEqual(
      expect.objectContaining({
        _tag: "OperationFailed",
        name: "melt.resume",
        error: expect.objectContaining({ _tag: "MintUnreachable" }),
      }),
    );
  });

  it("does not import change twice when the change landed before the operation closed", async () => {
    const storage = freshStorage();
    await interruptMelt(storage);
    await Effect.runPromise(
      seedProofs(mint, [proof(1, "chg")]).pipe(
        Effect.provide(Layer.succeed(ProofStore, storage.proofs)),
      ),
    );

    const resuming = makeWallet({
      checkQuote: () => Promise.resolve(quoteResponse({ state: "PAID" })),
      restore: () => Promise.resolve({ proofs: [proof(1, "chg")] }),
    });
    const exit = await makeHarness(resuming.wallet, storage).run(
      resumeAndInspect,
    );
    assert(Exit.isSuccess(exit));
    expect(exit.value.results[0]).toMatchObject({
      status: "paid",
      receipt: { changeAmount: 0 },
    });
    expect(secretsOf(proofsIn(exit.value.proofs, "available"))).toEqual([
      "chg",
      "k1",
    ]);
    expect(onlyMelt(exit.value.operations).status).toBe("paid");
  });

  it("carries a legacy key-value record over into a melt operation", async () => {
    const storage = freshStorage();
    const legacyKey =
      LEGACY_PENDING_MELT_KEY_PREFIX +
      [mint, "quote-1"].map(encodeURIComponent).join(".");
    await Effect.runPromise(
      storage.kv.set(
        legacyKey,
        JSON.stringify({
          quoteId: "quote-1",
          mint,
          unit: "sat",
          keysetId: KEYSET_HEX,
          invoice,
          amount: 10,
          feeReserve: 2,
          inputsTotal: 13,
          expiresAt: null,
          createdAt: Math.floor(Date.now() / 1000) - 60,
          blankCounter: 66,
        }),
      ),
    );

    const resuming = makeWallet({
      checkQuote: () => Promise.resolve(quoteResponse({ state: "PAID" })),
      restore: () => Promise.resolve({ proofs: [proof(1, "chg")] }),
    });
    const exit = await makeHarness(resuming.wallet, storage).run(
      resumeAndInspect,
    );
    assert(Exit.isSuccess(exit));
    const operation = onlyMelt(exit.value.operations);
    expect(operation).toMatchObject({
      kind: "melt",
      status: "paid",
      mint,
      quoteId: "quote-1",
      amount: 10,
      feeReserve: 2,
      inputsTotal: 13,
      counter: 66,
    });
    expect(exit.value.results[0]).toMatchObject({
      status: "paid",
      operationId: operation.id,
      receipt: { changeAmount: 1 },
    });
    // The carried-over blank slot is what the reclaim scans.
    expect(resuming.restoreCalls).toEqual([{ start: 66, count: 2 }]);
    expect(
      await Effect.runPromise(
        storage.kv.listKeys(LEGACY_PENDING_MELT_KEY_PREFIX),
      ),
    ).toEqual([]);
  });

  it("does nothing without operations", async () => {
    const { wallet, checkQuoteCalls } = makeWallet({});
    const exit = await makeHarness(wallet).run(resumeAndInspect);
    assert(Exit.isSuccess(exit));
    expect(exit.value.results).toEqual([]);
    expect(checkQuoteCalls).toEqual([]);
  });
});

describe("persisted melt quotes", () => {
  it("uses the persisted quote and rejects an invoice mismatch before swapping", async () => {
    const { wallet, sendCalls, checkQuoteCalls } = makeWallet({
      quote: () => Promise.reject(new Error("must not issue another quote")),
      checkQuote: () =>
        Promise.resolve(quoteResponse({ request: "lnbc1another" })),
    });
    const { run } = makeHarness(wallet);
    const result = await run(
      Effect.flatMap(Melt, (melt) =>
        Effect.flip(
          melt.melt(
            new MeltDraft({ ...draft, quoteId: QuoteId.make("quote-1") }),
          ),
        ),
      ),
    );
    assert(Exit.isSuccess(result));
    expect(result.value).toMatchObject({
      _tag: "MintRejected",
      detail: "melt quote does not match invoice",
    });
    expect(checkQuoteCalls).toEqual(["quote-1"]);
    expect(sendCalls).toEqual([]);
  });
  it("reports a settled quote without creating a second payment or exposing invoice text", async () => {
    const { wallet, sendCalls } = makeWallet({
      checkQuote: () => Promise.resolve(quoteResponse({ state: "PAID" })),
    });
    const { run, events } = makeHarness(wallet);
    const result = await run(
      Effect.gen(function* () {
        const melt = yield* Melt;
        const quote = yield* melt.quote(draft);
        return yield* melt.status(quote);
      }),
    );
    assert(Exit.isSuccess(result));
    expect(result.value).toBe("PAID");
    expect(sendCalls).toEqual([]);
    expect(JSON.stringify(events)).not.toContain(invoice);
  });
});
