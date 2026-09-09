import type {
  MeltProofsResponse,
  MeltQuoteBolt11Response,
  MeltQuoteState,
  Proof as CashuProof,
  SendResponse,
} from "@cashu/cashu-ts";
import { Amount, getEncodedToken, MintOperationError } from "@cashu/cashu-ts";
import { Effect, Exit, Layer, TestClock, TestContext } from "effect";
import {
  Bolt11Invoice,
  CurrencyUnit,
  KeysetId,
  QuoteId,
  MintUrl,
} from "../domain/primitives";
import { deterministicCounterKey } from "../internal/counters";
import { WalletInstances } from "../mint/internal/WalletInstances";
import type { LoadedWallet } from "../mint/internal/WalletInstances";
import { KeyValueStore } from "../ports/KeyValueStore";
import type { KeyValueStoreService } from "../ports/KeyValueStore";
import { TokenStore } from "../ports/TokenStore";
import type { StoredTokenRow } from "../ports/TokenStore";
import { runOnTestClock } from "../testing/clock";
import { fakeWallet, KEYSET_HEX, proof } from "../testing/fakeWallet";
import { recordingInspector } from "../testing/inspector";
import { amountOf, seedRow } from "../testing/rows";
import { freshStorage } from "../testing/storage";
import type { Storage } from "../testing/storage";
import { decodeTokenText } from "../token/codec";
import type { TokenState } from "../token/domain";
import { MeltDraft } from "./domain";
import { PENDING_MELT_KEY_PREFIX, pendingMelts } from "./internal/pendingMelt";
import { Melt } from "./Melt";

const mint = MintUrl.make("https://mint.example");
const counterKey = deterministicCounterKey({
  mint,
  unit: CurrencyUnit.make("sat"),
  keysetId: KeysetId.make(KEYSET_HEX),
});
const invoice = Bolt11Invoice.make("lnbc1fakeinvoice");
const draft = new MeltDraft({ mint, invoice });

// Row A (4+2) and row B (8): 14 sats available at the mint under test.
const tokenA = getEncodedToken({
  mint,
  unit: "sat",
  proofs: [proof(4, "src-a1"), proof(2, "src-a2")],
});
const tokenB = getEncodedToken({
  mint,
  unit: "sat",
  proofs: [proof(8, "src-b1")],
});

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
}

const makeWallet = (args: FakeWalletArgs) => {
  const sendCalls: SendCall[] = [];
  const meltCalls: MeltCall[] = [];
  const checkQuoteCalls: string[] = [];
  const restoreCalls: Array<{ start: number; count: number }> = [];
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
  return { wallet, sendCalls, meltCalls, checkQuoteCalls, restoreCalls };
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
        Layer.succeed(TokenStore, storage.tokens),
        inspector.layer,
      ),
    ),
  );
  const run = <A, E>(
    program: Effect.Effect<
      A,
      E,
      Melt | TokenStore | KeyValueStore | WalletInstances
    >,
  ) => Effect.runPromiseExit(program.pipe(Effect.provide(layer)));
  return { run, events: inspector.events };
};

const meltAndInspect = (seeds: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    yield* Effect.forEach(seeds, (tokenText) => seedRow(tokenText));
    const melt = yield* Melt;
    const kv = yield* KeyValueStore;
    const tokenStore = yield* TokenStore;
    const receipt = yield* Effect.either(melt.melt(draft));
    return {
      receipt,
      rows: yield* tokenStore.loadAll,
      counter: yield* kv.get(counterKey),
    };
  });

const rowsByState = (
  rows: ReadonlyArray<StoredTokenRow>,
  state: TokenState,
): ReadonlyArray<StoredTokenRow> => rows.filter((row) => row.state === state);

const pendingKeys = (kv: KeyValueStoreService) =>
  Effect.runPromise(kv.listKeys(PENDING_MELT_KEY_PREFIX));

const pendingRecord = (kv: KeyValueStoreService) =>
  Effect.runPromise(pendingMelts.read(kv, mint, QuoteId.make("quote-1")));

const resumeAndInspect = Effect.gen(function* () {
  const results = yield* (yield* Melt).resumePending;
  return { results, rows: yield* (yield* TokenStore).loadAll };
});

/**
 * A melt whose request left but whose outcome the process never learned:
 * the response and the follow-up quote check both fail, so the runtime ends
 * with `PaymentPending`, a `reserved` row, and a record naming both.
 */
const interruptMelt = async (storage: Storage) => {
  const { wallet, meltCalls } = makeWallet({
    send: () => Promise.resolve(swappedThirteen()),
    melt: () => Promise.reject(new TypeError("fetch failed")),
    checkQuote: () => Promise.reject(new TypeError("fetch failed")),
  });
  const exit = await makeHarness(wallet, storage).run(
    meltAndInspect([tokenA, tokenB]),
  );
  assert(Exit.isSuccess(exit));
  assert(exit.value.receipt._tag === "Left");
  expect(exit.value.receipt.left._tag).toBe("PaymentPending");
  expect(meltCalls).toHaveLength(1);
  return exit.value;
};

describe("Melt.quote", () => {
  it("prices the payment without touching stored tokens", async () => {
    const { wallet, sendCalls } = makeWallet({});
    const { run, events } = makeHarness(wallet);

    const exit = await run(
      Effect.gen(function* () {
        yield* seedRow(tokenA);
        const melt = yield* Melt;
        const quoted = yield* melt.quote(draft);
        return { quoted, rows: yield* (yield* TokenStore).loadAll };
      }),
    );
    assert(Exit.isSuccess(exit));
    expect(exit.value.quoted).toMatchObject({
      quoteId: "quote-1",
      mint,
      amount: 10,
      feeReserve: 2,
    });
    expect(exit.value.rows).toHaveLength(1);
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
        // The record is durable before the request reaches the mint.
        expect(await pendingRecord(storage.kv)).toMatchObject({
          quoteId: "quote-1",
          amount: 10,
          feeReserve: 2,
          inputsTotal: 13,
          blankCounter: 66,
        });
        return meltResponse("PAID", [proof(1, "chg")]);
      },
    });
    const { run, events } = makeHarness(wallet, storage);

    const exit = await run(meltAndInspect([tokenA, tokenB]));
    assert(Exit.isSuccess(exit));
    const { receipt, rows, counter } = exit.value;
    expect(await pendingKeys(storage.kv)).toEqual([]);

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

    // Sources are gone; the swap remainder and the melt change remain.
    const accepted = rowsByState(rows, "accepted");
    expect(accepted).toHaveLength(2);
    expect(accepted.map(amountOf).sort()).toEqual([1, 1]);
    expect(rowsByState(rows, "reserved")).toHaveLength(0);
    expect(rows).toHaveLength(2);

    expect(events.map((event) => event._tag)).toEqual([
      "QuoteStateChanged",
      "CounterAdvanced",
      "TokenLifecycleChanged",
      "TokenLifecycleChanged",
      "CounterAdvanced",
      "QuoteStateChanged",
      "TokenLifecycleChanged",
      "OperationSucceeded",
    ]);
    expect(events[0]).toMatchObject({ flow: "melt", state: "UNPAID" });
    expect(events[1]).toMatchObject({ from: 1, to: 66, reason: "used" });
    expect(events[2]).toMatchObject({ to: "accepted", reason: "melt-keep" });
    expect(events[3]).toMatchObject({ to: "reserved", reason: "melt" });
    expect(events[4]).toMatchObject({ from: 66, to: 68, reason: "used" });
    expect(events[5]).toMatchObject({ flow: "melt", state: "PAID" });
    expect(events[6]).toMatchObject({ to: "accepted", reason: "melt-change" });
    expect(events[7]).toMatchObject({
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

  it("pays with unspent proofs from a mixed row and preserves pending inputs", async () => {
    const mixed = getEncodedToken({
      mint,
      unit: "sat",
      proofs: [proof(4, "src-a1"), proof(2, "src-a2"), proof(32, "locked")],
    });
    const { wallet, sendCalls } = makeWallet({
      stateOf: (secret) => (secret === "locked" ? "PENDING" : "UNSPENT"),
      send: () => Promise.resolve(swappedThirteen()),
      melt: () => Promise.resolve(meltResponse("PAID", [proof(1, "change")])),
    });
    const { run, events } = makeHarness(wallet);
    const exit = await run(meltAndInspect([mixed, tokenB]));
    expect(exit).toMatchObject({ _tag: "Success" });
    assert(Exit.isSuccess(exit));
    assert(exit.value.receipt._tag === "Right");
    expect(sendCalls[0]?.secrets).toEqual(["src-a1", "src-a2", "src-b1"]);
    expect(exit.value.rows.map(amountOf).sort()).toEqual([1, 1, 32]);
    const retained = exit.value.rows.find(
      (row) => row.originalTokenText === mixed,
    );
    assert(retained !== undefined);
    expect(
      decodeTokenText(retained.tokenText)?.proofs.map((proof) => proof.secret),
    ).toEqual(["locked"]);
    expect(JSON.stringify(events)).not.toContain("locked");
  });

  it("does not swap or drop a mixed row when only pending funds cover the payment", async () => {
    const { wallet, sendCalls, meltCalls } = makeWallet({
      stateOf: (secret) => (secret === "src-a1" ? "PENDING" : "UNSPENT"),
    });
    const { run } = makeHarness(wallet);
    const exit = await run(meltAndInspect([tokenA, tokenB]));
    assert(Exit.isSuccess(exit));
    assert(exit.value.receipt._tag === "Left");
    expect(exit.value.receipt.left).toMatchObject({
      _tag: "InsufficientFunds",
      available: 10,
    });
    expect(sendCalls).toEqual([]);
    expect(meltCalls).toEqual([]);
    expect(exit.value.rows.map((row) => row.tokenText)).toEqual([
      tokenA,
      tokenB,
    ]);
  });

  it("fails with InsufficientFunds against amount + feeReserve before swapping", async () => {
    const { wallet, sendCalls } = makeWallet({});
    const { run } = makeHarness(wallet);

    const exit = await run(meltAndInspect([tokenB]));
    assert(Exit.isSuccess(exit));
    assert(exit.value.receipt._tag === "Left");
    expect(exit.value.receipt.left).toMatchObject({
      _tag: "InsufficientFunds",
      required: 12,
      available: 8,
    });
    expect(sendCalls).toEqual([]);
    expect(exit.value.rows.every((row) => row.state === "accepted")).toBe(true);
  });

  it("fails with QuoteExpired without touching any row", async () => {
    const { wallet, sendCalls, meltCalls } = makeWallet({
      quote: () => Promise.resolve(quoteResponse({ expiry: 1000 })),
    });
    const { run } = makeHarness(wallet);

    const exit = await run(meltAndInspect([tokenA, tokenB]));
    assert(Exit.isSuccess(exit));
    assert(exit.value.receipt._tag === "Left");
    expect(exit.value.receipt.left).toMatchObject({
      _tag: "QuoteExpired",
      quoteId: "quote-1",
      mint,
    });
    expect(sendCalls).toEqual([]);
    expect(meltCalls).toEqual([]);
    expect(exit.value.rows.every((row) => row.state === "accepted")).toBe(true);
  });

  it("recovers a blank-output counter collision via NUT-09 and retries", async () => {
    const { wallet, meltCalls, restoreCalls } = makeWallet({
      send: () => Promise.resolve(swappedThirteen()),
      melt: (call) =>
        call.counter < 100
          ? Promise.reject(outputsAlreadySigned())
          : Promise.resolve(meltResponse("PAID", [proof(1, "chg")])),
      restore: () =>
        Promise.resolve({ proofs: [], lastCounterWithSignature: 99 }),
    });
    const { run } = makeHarness(wallet);

    const exit = await run(meltAndInspect([tokenA, tokenB]));
    assert(Exit.isSuccess(exit));
    expect(exit.value.receipt._tag).toBe("Right");
    expect(meltCalls.map((call) => call.counter)).toEqual([66, 100]);
    expect(restoreCalls).toEqual([{ start: 66, count: 100 }]);
    expect(exit.value.counter).toBe("102"); // 100 + 2 blank slots
  });

  it("returns the reserved inputs to balance on a definitive rejection", async () => {
    const { wallet } = makeWallet({
      send: () => Promise.resolve(swappedThirteen()),
      melt: () =>
        Promise.reject(new MintOperationError(20003, "unable to pay invoice")),
    });
    const { run } = makeHarness(wallet);

    const exit = await run(meltAndInspect([tokenA, tokenB]));
    assert(Exit.isSuccess(exit));
    const { receipt, rows } = exit.value;
    assert(receipt._tag === "Left");
    expect(receipt.left).toMatchObject({ _tag: "MintRejected", code: 20003 });

    // Nothing lost: the swap remainder and the released inputs are balance.
    const accepted = rowsByState(rows, "accepted");
    expect(accepted.map(amountOf).sort()).toEqual([1, 13]);
    expect(rowsByState(rows, "reserved")).toHaveLength(0);
  });

  it("treats an UNPAID melt response as a failed payment and releases the inputs", async () => {
    const { wallet } = makeWallet({
      send: () => Promise.resolve(swappedThirteen()),
      melt: () => Promise.resolve(meltResponse("UNPAID", [])),
    });
    const { run } = makeHarness(wallet);

    const exit = await run(meltAndInspect([tokenA, tokenB]));
    assert(Exit.isSuccess(exit));
    assert(exit.value.receipt._tag === "Left");
    expect(exit.value.receipt.left).toMatchObject({
      _tag: "PaymentFailed",
      quoteId: "quote-1",
    });
    expect(rowsByState(exit.value.rows, "accepted").map(amountOf)).toContain(
      13,
    );
    expect(rowsByState(exit.value.rows, "reserved")).toHaveLength(0);
  });

  it("finishes a PENDING payment once the quote turns PAID, reclaiming change", async () => {
    const { wallet, restoreCalls } = makeWallet({
      send: () => Promise.resolve(swappedThirteen()),
      melt: () => Promise.resolve(meltResponse("PENDING", [])),
      checkQuote: () => Promise.resolve(quoteResponse({ state: "PAID" })),
      restore: () => Promise.resolve({ proofs: [proof(1, "chg")] }),
    });
    const { run } = makeHarness(wallet);

    const exit = await run(meltAndInspect([tokenA, tokenB]));
    assert(Exit.isSuccess(exit));
    const { receipt, rows } = exit.value;
    assert(receipt._tag === "Right");
    expect(receipt.right).toMatchObject({ feePaid: 2, changeAmount: 1 });
    // The change came from re-deriving the melt's own blank range.
    expect(restoreCalls).toEqual([{ start: 66, count: 2 }]);
    expect(rowsByState(rows, "reserved")).toHaveLength(0);
  });

  it("hands a payment that stays pending to resume, inputs reserved under the record", async () => {
    const storage = freshStorage();
    const { wallet } = makeWallet({
      send: () => Promise.resolve(swappedThirteen()),
      melt: () => Promise.resolve(meltResponse("PENDING", [])),
      checkQuote: () => Promise.resolve(quoteResponse({ state: "PENDING" })),
    });
    const { run } = makeHarness(wallet, storage);

    const exit = await run(
      Effect.gen(function* () {
        // Row timestamps are positive unix seconds; the TestClock starts at 0.
        yield* TestClock.adjust("1000 seconds");
        return yield* runOnTestClock(
          meltAndInspect([tokenA, tokenB]),
          "500 millis",
        );
      }).pipe(Effect.provide(TestContext.TestContext)),
    );
    assert(Exit.isSuccess(exit));
    assert(exit.value.receipt._tag === "Left");
    // Neither balance nor destroyed: the record lets `resumePending` settle it.
    const reserved = rowsByState(exit.value.rows, "reserved");
    expect(reserved).toHaveLength(1);
    expect(amountOf(reserved[0])).toBe(13);
    expect(exit.value.receipt.left).toMatchObject({
      _tag: "PaymentPending",
      mint,
      quoteId: "quote-1",
      rowId: reserved[0]?.id,
      amount: 10,
    });
    expect(await pendingRecord(storage.kv)).toMatchObject({
      rowId: reserved[0]?.id,
      blankCounter: 66,
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

    const exit = await run(meltAndInspect([tokenA, tokenB]));
    assert(Exit.isSuccess(exit));
    const { receipt, rows } = exit.value;
    assert(receipt._tag === "Right");
    expect(receipt.right).toMatchObject({ paidAmount: 10, changeAmount: 1 });
    expect(restoreCalls).toEqual([{ start: 66, count: 2 }]);
    expect(rowsByState(rows, "reserved")).toHaveLength(0);
  });

  it("keeps the inputs reserved under the record when a lost response cannot be resolved", async () => {
    const storage = freshStorage();
    const { rows } = await interruptMelt(storage);
    expect(rowsByState(rows, "reserved")).toHaveLength(1);
    expect(await pendingKeys(storage.kv)).toHaveLength(1);
  });

  it("releases the inputs when the quote check after a lost response says UNPAID", async () => {
    const storage = freshStorage();
    const { wallet } = makeWallet({
      send: () => Promise.resolve(swappedThirteen()),
      melt: () => Promise.reject(new TypeError("fetch failed")),
      checkQuote: () => Promise.resolve(quoteResponse({ state: "UNPAID" })),
    });
    const exit = await makeHarness(wallet, storage).run(
      meltAndInspect([tokenA, tokenB]),
    );
    assert(Exit.isSuccess(exit));
    assert(exit.value.receipt._tag === "Left");
    expect(exit.value.receipt.left._tag).toBe("PaymentFailed");
    expect(rowsByState(exit.value.rows, "accepted").map(amountOf)).toContain(
      13,
    );
    expect(await pendingKeys(storage.kv)).toEqual([]);
  });

  it("excludes NUT-07 spent rows and marks them before melting", async () => {
    const spentToken = getEncodedToken({
      mint,
      unit: "sat",
      proofs: [proof(3, "src-z1")],
    });
    const { wallet, sendCalls } = makeWallet({
      stateOf: (secret) => (secret === "src-z1" ? "SPENT" : "UNSPENT"),
      send: () => Promise.resolve(swappedThirteen()),
      melt: () => Promise.resolve(meltResponse("PAID", [proof(1, "chg")])),
    });
    const { run } = makeHarness(wallet);

    const exit = await run(meltAndInspect([tokenA, tokenB, spentToken]));
    assert(Exit.isSuccess(exit));
    expect(exit.value.receipt._tag).toBe("Right");
    expect(sendCalls[0]?.secrets).toEqual(["src-a1", "src-a2", "src-b1"]);

    const errorRow = rowsByState(exit.value.rows, "error")[0];
    expect(errorRow?.tokenText).toBe(spentToken);
    expect(JSON.parse(errorRow?.error ?? "")).toMatchObject({
      _tag: "TokenAlreadySpent",
      mint,
    });
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

    const { results, rows } = exit.value;
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      quoteId: "quote-1",
      mint,
      amount: 10,
      status: "paid",
      receipt: { paidAmount: 10, feePaid: 2, changeAmount: 1 },
    });
    expect(resuming.restoreCalls).toEqual([{ start: 66, count: 2 }]);
    expect(resuming.meltCalls).toEqual([]);
    // The swap remainder and the change are balance; the inputs are gone.
    expect(rowsByState(rows, "accepted").map(amountOf).sort()).toEqual([1, 1]);
    expect(rowsByState(rows, "reserved")).toHaveLength(0);
    expect(await pendingKeys(storage.kv)).toEqual([]);

    expect(events.map((event) => event._tag)).toEqual([
      "QuoteStateChanged",
      "TokenLifecycleChanged",
      "OperationSucceeded",
      "OperationSucceeded",
    ]);
    expect(events[2]).toMatchObject({
      name: "melt.resume",
      params: { mint, quoteId: "quote-1", rowId: results[0]?.rowId },
    });
    expect(events[3]).toMatchObject({ name: "melt.resumePending" });
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
    expect(
      rowsByState(exit.value.rows, "accepted").map(amountOf).sort(),
    ).toEqual([1, 13]);
    expect(rowsByState(exit.value.rows, "reserved")).toHaveLength(0);
    expect(await pendingKeys(storage.kv)).toEqual([]);
  });

  it("leaves a PENDING payment and its row untouched", async () => {
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
    expect(rowsByState(exit.value.rows, "reserved")).toHaveLength(1);
    expect(await pendingKeys(storage.kv)).toHaveLength(1);
  });

  it("keeps the record when the mint gives no answer, even past the quote expiry", async () => {
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
    expect(rowsByState(exit.value.rows, "reserved")).toHaveLength(1);
    expect(await pendingKeys(storage.kv)).toHaveLength(1);
    expect(events).toContainEqual(
      expect.objectContaining({
        _tag: "OperationFailed",
        name: "melt.resume",
        error: expect.objectContaining({ _tag: "MintUnreachable" }),
      }),
    );
  });

  it("does not import change twice when the change row landed before the record was cleared", async () => {
    const storage = freshStorage();
    await interruptMelt(storage);
    const changeRow = getEncodedToken({
      mint,
      unit: "sat",
      proofs: [proof(1, "chg")],
    });
    await Effect.runPromise(
      seedRow(changeRow).pipe(
        Effect.provide(Layer.succeed(TokenStore, storage.tokens)),
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
    expect(exit.value.results[0]).toMatchObject({ status: "paid" });
    expect(
      rowsByState(exit.value.rows, "accepted").map(amountOf).sort(),
    ).toEqual([1, 1]);
    expect(await pendingKeys(storage.kv)).toEqual([]);
  });

  it("does nothing without records", async () => {
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
