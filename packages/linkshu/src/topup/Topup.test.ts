import type {
  MintProofsConfig,
  MintQuoteBolt11Response,
  Proof,
} from "@cashu/cashu-ts";
import { Amount as CashuAmount, MintOperationError } from "@cashu/cashu-ts";
import { Effect, Exit, Layer, TestClock, TestContext } from "effect";
import type { Scope } from "effect";
import {
  Amount,
  Bolt11Invoice,
  CurrencyUnit,
  KeysetId,
  MintUrl,
  QuoteId,
  UnixSeconds,
} from "../domain/primitives";
import { deterministicCounterKey } from "../internal/counters";
import { WalletInstances } from "../mint/internal/WalletInstances";
import type { LoadedWallet } from "../mint/internal/WalletInstances";
import { KeyValueStore } from "../ports/KeyValueStore";
import type { KeyValueStoreService } from "../ports/KeyValueStore";
import { TokenStore } from "../ports/TokenStore";
import { runOnTestClock } from "../testing/clock";
import {
  answerProofStates,
  fakeWallet,
  KEYSET_HEX,
  proof,
} from "../testing/fakeWallet";
import { recordingInspector } from "../testing/inspector";
import { freshStorage } from "../testing/storage";
import type { Storage } from "../testing/storage";
import { PaidQuoteDraft, QuoteLockingKey, TopupDraft } from "./domain";
import {
  PENDING_TOPUP_KEY_PREFIX,
  PendingTopup,
  pendingTopups,
} from "./internal/pendingTopup";
import { Topup } from "./Topup";

const mint = MintUrl.make("https://mint.example");
const sat = CurrencyUnit.make("sat");
const counterKey = deterministicCounterKey({
  mint,
  unit: sat,
  keysetId: KeysetId.make(KEYSET_HEX),
});

const invoice = "lnbc160n1pexampleinvoice";
const quoteId = "quote-1";

const mintedProofs = [proof(8, "topup-a"), proof(8, "topup-b")];

const quoteResponse = (
  state: "UNPAID" | "PAID" | "ISSUED",
  expiry: number | null = null,
): MintQuoteBolt11Response => ({
  quote: quoteId,
  request: invoice,
  unit: "sat",
  amount: CashuAmount.from(16),
  state,
  expiry,
});

interface FakeWalletArgs {
  /** The quote `start` creates; defaults to a fresh unpaid one. */
  readonly created?: MintQuoteBolt11Response;
  /** One entry per `checkMintQuoteBolt11` call; the last one repeats. */
  readonly states: ReadonlyArray<MintQuoteBolt11Response>;
  /** Replaces the state sequence entirely when set. */
  readonly check?: () => Promise<MintQuoteBolt11Response>;
  readonly mintProofs?: (counter: number) => Promise<Proof[]>;
  readonly restore?: () => Promise<{
    proofs: Proof[];
    lastCounterWithSignature?: number;
  }>;
}

const makeWallet = (args: FakeWalletArgs) => {
  const mintCounters: number[] = [];
  const mintConfigs: Array<MintProofsConfig | undefined> = [];
  const restoreCalls: Array<{ start: number; count: number }> = [];
  let checks = 0;
  const wallet = fakeWallet({
    keysetId: KEYSET_HEX,
    checkProofsStates: answerProofStates(),
    createMintQuoteBolt11: () =>
      Promise.resolve(args.created ?? quoteResponse("UNPAID")),
    checkMintQuoteBolt11: () => {
      if (args.check !== undefined) return args.check();
      const response =
        args.states[Math.min(checks, args.states.length - 1)] ??
        quoteResponse("UNPAID");
      checks += 1;
      return Promise.resolve(response);
    },
    mintProofsBolt11: (_amount, _quote, config, outputType) => {
      const counter =
        outputType?.type === "deterministic" ? outputType.counter : -1;
      mintCounters.push(counter);
      mintConfigs.push(config);
      return args.mintProofs
        ? args.mintProofs(counter)
        : Promise.resolve(mintedProofs);
    },
    restore: (start, count) => {
      restoreCalls.push({ start, count });
      return args.restore
        ? args.restore()
        : Promise.reject(new Error("restore unavailable"));
    },
  });
  return { wallet, mintCounters, mintConfigs, restoreCalls };
};

/** One runtime over the given storage — a second one models a restart. */
const makeHarness = (wallet: LoadedWallet, storage: Storage) => {
  const inspector = recordingInspector();
  const layer = Topup.DefaultWithoutDependencies.pipe(
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
  const run = <A, E>(program: Effect.Effect<A, E, Topup | Scope.Scope>) =>
    Effect.runPromiseExit(program.pipe(Effect.scoped, Effect.provide(layer)));
  return { run, events: inspector.events };
};

const draft = new TopupDraft({ mint, amount: Amount.make(16) });

const pendingKeys = (kv: KeyValueStoreService) =>
  Effect.runPromise(kv.listKeys(PENDING_TOPUP_KEY_PREFIX));

const startAndAwait = Effect.gen(function* () {
  const topup = yield* Topup;
  const handle = yield* topup.start(draft);
  return { quote: handle.quote, receipt: yield* handle.result };
});

const resumeAndAwait = Effect.gen(function* () {
  const topup = yield* Topup;
  const handles = yield* topup.resumePending();
  const first = handles[0];
  return {
    count: handles.length,
    receipt: first === undefined ? null : yield* first.result,
  };
});

describe("Topup", () => {
  it("mints an accepted row once the quote reports paid", async () => {
    const storage = freshStorage();
    const { wallet, mintCounters } = makeWallet({
      states: [quoteResponse("PAID")],
    });
    const { run, events } = makeHarness(wallet, storage);

    const exit = await run(startAndAwait);

    assert(Exit.isSuccess(exit));
    expect(exit.value.quote.invoice).toBe(invoice);
    expect(exit.value.quote.quoteId).toBe(quoteId);
    expect(exit.value.receipt.amount).toBe(16);
    expect(exit.value.receipt.quoteId).toBe(quoteId);

    const rows = await Effect.runPromise(storage.tokens.loadAll);
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe("accepted");
    expect(rows[0].id).toBe(exit.value.receipt.rowId);

    // Counters floor at 1, and the whole reserved block is burned.
    expect(mintCounters).toEqual([1]);
    expect(await Effect.runPromise(storage.kv.get(counterKey))).toBe("65");

    // The record only exists while the topup is unfinished.
    expect(await pendingKeys(storage.kv)).toEqual([]);

    const quoteEvents = events.filter(
      (event) => event._tag === "QuoteStateChanged",
    );
    expect(quoteEvents.map((event) => event.state)).toEqual(["UNPAID", "PAID"]);
    expect(
      events.some(
        (event) =>
          event._tag === "OperationSucceeded" &&
          event.name === "topup.complete",
      ),
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          event._tag === "TokenLifecycleChanged" && event.reason === "topup",
      ),
    ).toBe(true);
  });

  it("resumes an interrupted topup on a fresh runtime over the same storage", async () => {
    const storage = freshStorage();

    // First run: the quote is created but the invoice is never paid, and the
    // runtime goes away while the topup is still pending.
    const first = makeWallet({ states: [quoteResponse("UNPAID")] });
    const interrupted = await makeHarness(first.wallet, storage).run(
      Effect.gen(function* () {
        const handle = yield* (yield* Topup).start(draft);
        return handle.quote;
      }),
    );
    assert(Exit.isSuccess(interrupted));
    expect(interrupted.value.invoice).toBe(invoice);
    expect(await pendingKeys(storage.kv)).toHaveLength(1);
    expect(first.mintCounters).toEqual([]);

    // Second run: same storage, nothing in memory. The invoice was paid in
    // the meantime and the topup finishes itself.
    const second = makeWallet({ states: [quoteResponse("PAID")] });
    const { run } = makeHarness(second.wallet, storage);
    const resumed = await run(resumeAndAwait);

    assert(Exit.isSuccess(resumed));
    expect(resumed.value.count).toBe(1);
    expect(resumed.value.receipt?.amount).toBe(16);

    const rows = await Effect.runPromise(storage.tokens.loadAll);
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe("accepted");
    expect(await pendingKeys(storage.kv)).toEqual([]);
  });

  it("reclaims proofs a lost response already had signed, without minting twice", async () => {
    const storage = freshStorage();

    const interrupting = makeWallet({
      states: [quoteResponse("PAID")],
      // The mint signs the outputs, then the response is lost in transit.
      mintProofs: () => Promise.reject(new TypeError("Failed to fetch")),
    });
    const crashed = await makeHarness(interrupting.wallet, storage).run(
      Effect.either(startAndAwait),
    );
    assert(Exit.isSuccess(crashed));
    assert(crashed.value._tag === "Left");
    expect(crashed.value.left._tag).toBe("MintUnreachable");

    // The reserved slot survived the crash, so the resume re-derives exactly
    // the outputs the mint signed.
    expect(await pendingKeys(storage.kv)).toHaveLength(1);
    expect(interrupting.mintCounters).toEqual([1]);

    const resuming = makeWallet({
      states: [quoteResponse("ISSUED")],
      restore: () =>
        Promise.resolve({ proofs: mintedProofs, lastCounterWithSignature: 2 }),
    });
    const resumed = await makeHarness(resuming.wallet, storage).run(
      resumeAndAwait,
    );

    assert(Exit.isSuccess(resumed));
    expect(resumed.value.receipt?.amount).toBe(16);
    // Reclaimed, never re-minted.
    expect(resuming.mintCounters).toEqual([]);
    expect(resuming.restoreCalls).toEqual([{ start: 1, count: 64 }]);

    const rows = await Effect.runPromise(storage.tokens.loadAll);
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe("accepted");
    expect(await pendingKeys(storage.kv)).toEqual([]);
  });

  it("resolves to the stored row when the proofs landed before the crash", async () => {
    const storage = freshStorage();
    const first = makeWallet({ states: [quoteResponse("PAID")] });
    const done = await makeHarness(first.wallet, storage).run(startAndAwait);
    assert(Exit.isSuccess(done));

    // The row was written but the record never cleared — the one window
    // `persistMinted` leaves open. Resuming must find the stored proofs
    // rather than import them a second time.
    await Effect.runPromise(
      pendingTopups.write(
        storage.kv,
        new PendingTopup({
          quoteId: QuoteId.make(quoteId),
          mint,
          unit: sat,
          keysetId: KeysetId.make(KEYSET_HEX),
          amount: Amount.make(16),
          invoice: Bolt11Invoice.make(invoice),
          expiresAt: null,
          createdAt: UnixSeconds.make(Math.floor(Date.now() / 1000)),
          mintCounter: 1,
        }),
      ),
    );

    const resuming = makeWallet({
      states: [quoteResponse("ISSUED")],
      restore: () =>
        Promise.resolve({ proofs: mintedProofs, lastCounterWithSignature: 2 }),
    });
    const resumed = await makeHarness(resuming.wallet, storage).run(
      resumeAndAwait,
    );

    assert(Exit.isSuccess(resumed));
    expect(resumed.value.receipt?.rowId).toBe(done.value.receipt.rowId);

    const rows = await Effect.runPromise(storage.tokens.loadAll);
    expect(rows).toHaveLength(1);
    expect(await pendingKeys(storage.kv)).toEqual([]);
  });

  it("fails with QuoteExpired and drops the record once an unpaid quote expires", async () => {
    const storage = freshStorage();
    const expired = Math.floor(Date.now() / 1000) - 60;
    const { wallet } = makeWallet({
      created: quoteResponse("UNPAID", expired),
      states: [quoteResponse("UNPAID", expired)],
    });
    const { run } = makeHarness(wallet, storage);

    const exit = await run(Effect.either(startAndAwait));

    assert(Exit.isSuccess(exit));
    assert(exit.value._tag === "Left");
    expect(exit.value.left._tag).toBe("QuoteExpired");
    expect(await Effect.runPromise(storage.tokens.loadAll)).toEqual([]);
    expect(await pendingKeys(storage.kv)).toEqual([]);
  });

  it("keeps the record when the mint is unreachable across the deadline", async () => {
    const storage = freshStorage();
    const { wallet } = makeWallet({
      // The TestClock starts the topup at t=1000s, so this deadline passes
      // 10s into the poll — well before the failure cap ends it.
      created: quoteResponse("UNPAID", 1010),
      states: [],
      check: () => Promise.reject(new TypeError("Failed to fetch")),
    });
    const { run } = makeHarness(wallet, storage);

    const exit = await run(
      Effect.gen(function* () {
        yield* TestClock.adjust("1000 seconds");
        return yield* runOnTestClock(Effect.either(startAndAwait), "5 seconds");
      }).pipe(Effect.provide(TestContext.TestContext)),
    );

    assert(Exit.isSuccess(exit));
    assert(exit.value._tag === "Left");
    // Unreachable, not expired: only the mint's own UNPAID answer may expire
    // a quote — it might have been paid while we could not check.
    expect(exit.value.left._tag).toBe("MintUnreachable");
    expect(await pendingKeys(storage.kv)).toHaveLength(1);
  });

  it("rescues a paid quote whose record outlived its deadline", async () => {
    const storage = freshStorage();
    const expired = Math.floor(Date.now() / 1000) - 3600;
    // Crash window: the invoice was paid, but the process died before any
    // mint attempt reserved counters — the record must not be pruned on time.
    await Effect.runPromise(
      pendingTopups.write(
        storage.kv,
        new PendingTopup({
          quoteId: QuoteId.make(quoteId),
          mint,
          unit: sat,
          keysetId: KeysetId.make(KEYSET_HEX),
          amount: Amount.make(16),
          invoice: Bolt11Invoice.make(invoice),
          expiresAt: UnixSeconds.make(expired),
          createdAt: UnixSeconds.make(expired - 600),
          mintCounter: null,
        }),
      ),
    );

    const { wallet, mintCounters } = makeWallet({
      states: [quoteResponse("PAID")],
    });
    const resumed = await makeHarness(wallet, storage).run(resumeAndAwait);

    assert(Exit.isSuccess(resumed));
    expect(resumed.value.count).toBe(1);
    expect(resumed.value.receipt?.amount).toBe(16);
    expect(mintCounters).toEqual([1]);
    expect(await pendingKeys(storage.kv)).toEqual([]);
  });

  it("drops an expired record once the mint confirms it unpaid on resume", async () => {
    const storage = freshStorage();
    const expired = Math.floor(Date.now() / 1000) - 3600;
    await Effect.runPromise(
      pendingTopups.write(
        storage.kv,
        new PendingTopup({
          quoteId: QuoteId.make(quoteId),
          mint,
          unit: sat,
          keysetId: KeysetId.make(KEYSET_HEX),
          amount: Amount.make(16),
          invoice: Bolt11Invoice.make(invoice),
          expiresAt: UnixSeconds.make(expired),
          createdAt: UnixSeconds.make(expired - 600),
          mintCounter: null,
        }),
      ),
    );

    const { wallet } = makeWallet({ states: [quoteResponse("UNPAID")] });
    const resumed = await makeHarness(wallet, storage).run(
      Effect.gen(function* () {
        const handles = yield* (yield* Topup).resumePending();
        const first = handles[0];
        return first === undefined ? null : yield* Effect.either(first.result);
      }),
    );

    assert(Exit.isSuccess(resumed));
    assert(resumed.value?._tag === "Left");
    expect(resumed.value.left._tag).toBe("QuoteExpired");
    expect(await pendingKeys(storage.kv)).toEqual([]);
  });

  it("moves past a counter collision and mints on the recovered slot", async () => {
    const storage = freshStorage();
    const { wallet, mintCounters } = makeWallet({
      states: [quoteResponse("PAID")],
      mintProofs: (counter) =>
        counter === 1
          ? Promise.reject(
              new MintOperationError(
                11005,
                "outputs have already been signed before",
              ),
            )
          : Promise.resolve(mintedProofs),
      restore: () =>
        Promise.resolve({ proofs: [], lastCounterWithSignature: 100 }),
    });
    const { run } = makeHarness(wallet, storage);

    const exit = await run(startAndAwait);

    assert(Exit.isSuccess(exit));
    expect(exit.value.receipt.amount).toBe(16);
    // The NUT-09 probe found signatures past the reserved block, so the retry
    // starts beyond them rather than at the block's end.
    expect(mintCounters).toEqual([1, 101]);
    expect(await pendingKeys(storage.kv)).toEqual([]);
  });

  it("surfaces a definitive mint rejection and keeps the record for a retry", async () => {
    const storage = freshStorage();
    const { wallet } = makeWallet({
      states: [quoteResponse("PAID")],
      mintProofs: () =>
        Promise.reject(new MintOperationError(20002, "quote already issued")),
    });
    const { run } = makeHarness(wallet, storage);

    const exit = await run(Effect.either(startAndAwait));

    assert(Exit.isSuccess(exit));
    assert(exit.value._tag === "Left");
    expect(exit.value.left._tag).toBe("MintRejected");
    // A reserved counter means the invoice was paid: the record must outlive
    // the failure so the funds stay reclaimable.
    expect(await pendingKeys(storage.kv)).toHaveLength(1);
  });
});

const lockingKey = QuoteLockingKey.make("ab".repeat(32));

const paidQuote = (locked: boolean) =>
  new PaidQuoteDraft({
    quoteId: QuoteId.make(quoteId),
    mint,
    amount: Amount.make(16),
    invoice: Bolt11Invoice.make(invoice),
    expiresAt: null,
    locked,
  });

const adoptAndAwait = (draft: PaidQuoteDraft, key?: QuoteLockingKey) =>
  Effect.gen(function* () {
    const topup = yield* Topup;
    return yield* Effect.either(
      topup.adopt(draft, key === undefined ? {} : { lockingKey: key }),
    );
  });

describe("Topup.adopt", () => {
  it("mints a quote someone else paid into an accepted row", async () => {
    const storage = freshStorage();
    const { wallet, mintCounters, mintConfigs } = makeWallet({
      states: [quoteResponse("PAID")],
    });
    const { run, events } = makeHarness(wallet, storage);

    const exit = await run(adoptAndAwait(paidQuote(false)));

    assert(Exit.isSuccess(exit));
    assert(exit.value._tag === "Right");
    expect(exit.value.right.amount).toBe(16);
    expect(exit.value.right.quoteId).toBe(quoteId);
    expect(mintCounters).toEqual([1]);
    expect(mintConfigs).toEqual([undefined]);

    const rows = await Effect.runPromise(storage.tokens.loadAll);
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe("accepted");
    expect(await pendingKeys(storage.kv)).toEqual([]);
    expect(
      events.some(
        (event) =>
          event._tag === "OperationSucceeded" && event.name === "topup.adopt",
      ),
    ).toBe(true);
  });

  it("hands the locking key to the mint call for a locked quote", async () => {
    const storage = freshStorage();
    const { wallet, mintConfigs } = makeWallet({
      states: [quoteResponse("PAID")],
    });
    const { run, events } = makeHarness(wallet, storage);

    const exit = await run(adoptAndAwait(paidQuote(true), lockingKey));

    assert(Exit.isSuccess(exit));
    assert(exit.value._tag === "Right");
    expect(mintConfigs).toEqual([{ privkey: lockingKey }]);
    // The key must never leave through the inspector.
    expect(JSON.stringify(events)).not.toContain(lockingKey);
  });

  it("rejects a locked quote without its key before touching the mint", async () => {
    const storage = freshStorage();
    const { wallet, mintCounters } = makeWallet({
      states: [quoteResponse("PAID")],
    });
    const { run } = makeHarness(wallet, storage);

    const exit = await run(adoptAndAwait(paidQuote(true)));

    assert(Exit.isSuccess(exit));
    assert(exit.value._tag === "Left");
    expect(exit.value.left._tag).toBe("MintRejected");
    expect(mintCounters).toEqual([]);
    expect(await pendingKeys(storage.kv)).toEqual([]);
  });

  it("leaves a quote another wallet already minted alone", async () => {
    const storage = freshStorage();
    const { wallet, mintCounters, restoreCalls } = makeWallet({
      states: [quoteResponse("ISSUED")],
    });
    const { run } = makeHarness(wallet, storage);

    const exit = await run(adoptAndAwait(paidQuote(false)));

    assert(Exit.isSuccess(exit));
    assert(exit.value._tag === "Left");
    expect(exit.value.left._tag).toBe("QuoteAlreadyIssued");
    expect(mintCounters).toEqual([]);
    expect(restoreCalls).toEqual([]);
    expect(await pendingKeys(storage.kv)).toEqual([]);
    expect(await Effect.runPromise(storage.kv.get(counterKey))).toBeNull();
  });

  it("treats a quote the mint still calls unpaid as a rejection", async () => {
    const storage = freshStorage();
    const { wallet, mintCounters } = makeWallet({
      states: [quoteResponse("UNPAID")],
    });
    const { run } = makeHarness(wallet, storage);

    const exit = await run(adoptAndAwait(paidQuote(false)));

    assert(Exit.isSuccess(exit));
    assert(exit.value._tag === "Left");
    expect(exit.value.left._tag).toBe("MintRejected");
    expect(mintCounters).toEqual([]);
    expect(await pendingKeys(storage.kv)).toEqual([]);
  });

  it("resumes an adopted locked quote after a crash, key in hand", async () => {
    const storage = freshStorage();
    const crashing = makeWallet({
      states: [quoteResponse("PAID")],
      mintProofs: () => Promise.reject(new TypeError("Failed to fetch")),
    });
    const crashed = await makeHarness(crashing.wallet, storage).run(
      adoptAndAwait(paidQuote(true), lockingKey),
    );
    assert(Exit.isSuccess(crashed));
    assert(crashed.value._tag === "Left");
    expect(crashed.value.left._tag).toBe("MintUnreachable");
    expect(await pendingKeys(storage.kv)).toHaveLength(1);

    // Without the key the resumed record fails before any mint call and
    // stays put; with it, the interrupted attempt finishes on its slot.
    const keyless = makeWallet({ states: [quoteResponse("PAID")] });
    const stuck = await makeHarness(keyless.wallet, storage).run(
      Effect.gen(function* () {
        const handles = yield* (yield* Topup).resumePending();
        const first = handles[0];
        return first === undefined ? null : yield* Effect.either(first.result);
      }),
    );
    assert(Exit.isSuccess(stuck));
    assert(stuck.value?._tag === "Left");
    expect(stuck.value.left._tag).toBe("MintRejected");
    expect(keyless.mintCounters).toEqual([]);
    expect(await pendingKeys(storage.kv)).toHaveLength(1);

    const resuming = makeWallet({ states: [quoteResponse("PAID")] });
    const resumed = await makeHarness(resuming.wallet, storage).run(
      Effect.gen(function* () {
        const handles = yield* (yield* Topup).resumePending({ lockingKey });
        const first = handles[0];
        return first === undefined ? null : yield* first.result;
      }),
    );
    assert(Exit.isSuccess(resumed));
    expect(resumed.value?.amount).toBe(16);
    expect(resuming.mintCounters).toEqual([1]);
    expect(resuming.mintConfigs).toEqual([{ privkey: lockingKey }]);
    expect(await pendingKeys(storage.kv)).toEqual([]);
  });

  it("decodes records written before the locked flag existed", async () => {
    const storage = freshStorage();
    await Effect.runPromise(
      storage.kv.set(
        PENDING_TOPUP_KEY_PREFIX +
          [mint, quoteId].map(encodeURIComponent).join("."),
        JSON.stringify({
          quoteId,
          mint,
          unit: "sat",
          keysetId: KEYSET_HEX,
          amount: 16,
          invoice,
          expiresAt: null,
          createdAt: Math.floor(Date.now() / 1000),
          mintCounter: null,
        }),
      ),
    );
    const { wallet, mintConfigs } = makeWallet({
      states: [quoteResponse("PAID")],
    });
    const resumed = await makeHarness(wallet, storage).run(resumeAndAwait);

    assert(Exit.isSuccess(resumed));
    expect(resumed.value.receipt?.amount).toBe(16);
    expect(mintConfigs).toEqual([undefined]);
  });
});
