import type {
  MintProofsConfig,
  MintQuoteBolt11Response,
  Proof,
} from "@cashu/cashu-ts";
import type { GetInfoResponse } from "@cashu/cashu-ts";
import {
  Amount as CashuAmount,
  MintInfo as CashuMintInfo,
  MintOperationError,
} from "@cashu/cashu-ts";
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
import { OperationStore } from "../ports/OperationStore";
import type { StoredOperation } from "../ports/OperationStore";
import { ProofStore } from "../ports/ProofStore";
import { runOnTestClock } from "../testing/clock";
import {
  answerProofStates,
  fakeWallet,
  KEYSET_HEX,
  proof,
} from "../testing/fakeWallet";
import { recordingInspector } from "../testing/inspector";
import { proofsIn } from "../testing/inventory";
import { freshStorage } from "../testing/storage";
import type { Storage } from "../testing/storage";
import { PaidQuoteDraft, QuoteLockingKey, TopupDraft } from "./domain";
import { topupRecords } from "./internal/topupRecords";
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

const LEGACY_PENDING_TOPUP_KEY_PREFIX = "linkshu.pendingTopup.";

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
  /** NUT-09 walk collision recovery runs from the colliding counter. */
  readonly probe?: () => Promise<{
    proofs: Proof[];
    lastCounterWithSignature?: number;
  }>;
}

const makeWallet = (args: FakeWalletArgs) => {
  const mintCounters: number[] = [];
  const mintConfigs: Array<MintProofsConfig | undefined> = [];
  const restoreCalls: Array<{ start: number; count: number }> = [];
  const probeCalls: Array<{ start: number; gapLimit: number }> = [];
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
    batchRestore: (gapLimit = 0, _batchSize, start = 0) => {
      probeCalls.push({ start, gapLimit });
      return args.probe
        ? args.probe()
        : Promise.reject(new Error("restore unavailable"));
    },
  });
  return { wallet, mintCounters, mintConfigs, restoreCalls, probeCalls };
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
        Layer.succeed(ProofStore, storage.proofs),
        Layer.succeed(OperationStore, storage.operations),
        inspector.layer,
      ),
    ),
  );
  const run = <A, E>(program: Effect.Effect<A, E, Topup | Scope.Scope>) =>
    Effect.runPromiseExit(program.pipe(Effect.scoped, Effect.provide(layer)));
  return { run, events: inspector.events };
};

/** A mint advertising NUT-17 pushes for exactly the topup's method and unit. */
const websocketMintInfo = (
  commands: string[] = ["bolt11_mint_quote"],
): GetInfoResponse => ({
  name: "Websocket mint",
  pubkey: "02" + "ab".repeat(32),
  version: "Nutshell/0.16.0",
  contact: [],
  nuts: {
    "4": { methods: [], disabled: false },
    "5": { methods: [], disabled: false },
    "17": { supported: [{ method: "bolt11", unit: "sat", commands }] },
  },
});

const draft = new TopupDraft({ mint, amount: Amount.make(16) });

const storedProofs = (storage: Storage) =>
  Effect.runPromise(storage.proofs.loadAll);

const topupOperations = (storage: Storage) =>
  Effect.runPromise(storage.operations.loadAll).then((operations) =>
    operations.filter((operation) => operation.kind === "topup"),
  );

const pendingTopups = (storage: Storage) =>
  topupOperations(storage).then((operations) =>
    operations.filter((operation) => operation.status === "pending"),
  );

const onlyTopup = async (storage: Storage): Promise<StoredOperation> => {
  const operations = await topupOperations(storage);
  expect(operations).toHaveLength(1);
  const [only] = operations;
  assert(only !== undefined);
  return only;
};

/** A pending `topup` operation written the way the flow writes its own. */
const writePendingTopup = (
  storage: Storage,
  record: {
    readonly counter: number | null;
    readonly expiresAt?: number | null;
    readonly createdAt?: number;
    readonly locked?: boolean;
  },
) =>
  Effect.runPromise(
    topupRecords({
      kv: storage.kv,
      operationStore: storage.operations,
      inspector: recordingInspector().service,
    }).create({
      quoteId: QuoteId.make(quoteId),
      mint,
      unit: sat,
      keysetId: KeysetId.make(KEYSET_HEX),
      amount: Amount.make(16),
      invoice: Bolt11Invoice.make(invoice),
      expiresAt:
        record.expiresAt === undefined || record.expiresAt === null
          ? null
          : UnixSeconds.make(record.expiresAt),
      createdAt: UnixSeconds.make(
        record.createdAt ?? Math.floor(Date.now() / 1000),
      ),
      counter: record.counter,
      locked: record.locked ?? false,
    }),
  );

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
  it("keeps waiting when the claim sees stale UNPAID after settlement", async () => {
    const storage = freshStorage();
    const { wallet, mintCounters } = makeWallet({
      states: [
        quoteResponse("PAID"),
        quoteResponse("UNPAID"),
        quoteResponse("PAID"),
      ],
    });
    const { run, events } = makeHarness(wallet, storage);

    const exit = await run(
      Effect.gen(function* () {
        yield* TestClock.adjust("1000 seconds");
        return yield* runOnTestClock(startAndAwait, "5 seconds");
      }).pipe(Effect.provide(TestContext.TestContext)),
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value.receipt.amount).toBe(16);
    expect(mintCounters).toEqual([1]);
    expect(proofsIn(await storedProofs(storage), "available")).toHaveLength(2);
    expect(await pendingTopups(storage)).toEqual([]);
    expect(
      events
        .filter((event) => event._tag === "QuoteStateChanged")
        .map((event) => event.state),
    ).toEqual(["UNPAID", "PAID", "UNPAID", "PAID"]);
  });

  it("mints available proofs once the quote reports paid", async () => {
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

    const proofs = await storedProofs(storage);
    expect(proofs).toHaveLength(2);
    expect(proofs.every((proof) => proof.state === "available")).toBe(true);
    expect(proofs.every((proof) => proof.operationId === null)).toBe(true);

    // Counters floor at 1, and the whole reserved block is burned.
    expect(mintCounters).toEqual([1]);
    expect(await Effect.runPromise(storage.kv.get(counterKey))).toBe("65");

    // The operation closes with the receipt naming it.
    const operation = await onlyTopup(storage);
    expect(operation).toMatchObject({
      id: exit.value.receipt.operationId,
      status: "done",
      counter: 1,
    });

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
    expect(events).toContainEqual(
      expect.objectContaining({
        _tag: "ProofsChanged",
        to: "available",
        amount: 16,
        reason: "topup",
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        _tag: "OperationChanged",
        kind: "topup",
        from: "pending",
        to: "done",
      }),
    );
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
    expect(await pendingTopups(storage)).toHaveLength(1);
    expect(first.mintCounters).toEqual([]);

    // Second run: same storage, nothing in memory. The invoice was paid in
    // the meantime and the topup finishes itself.
    const second = makeWallet({ states: [quoteResponse("PAID")] });
    const { run } = makeHarness(second.wallet, storage);
    const resumed = await run(resumeAndAwait);

    assert(Exit.isSuccess(resumed));
    expect(resumed.value.count).toBe(1);
    expect(resumed.value.receipt?.amount).toBe(16);

    expect(proofsIn(await storedProofs(storage), "available")).toHaveLength(2);
    expect((await onlyTopup(storage)).status).toBe("done");
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
    expect(await pendingTopups(storage)).toMatchObject([{ counter: 1 }]);
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

    expect(proofsIn(await storedProofs(storage), "available")).toHaveLength(2);
    expect((await onlyTopup(storage)).status).toBe("done");
  });

  it("resolves to the stored proofs when they landed before the crash", async () => {
    const storage = freshStorage();
    const first = makeWallet({ states: [quoteResponse("PAID")] });
    const done = await makeHarness(first.wallet, storage).run(startAndAwait);
    assert(Exit.isSuccess(done));

    // The proofs were written but the operation never closed — the one
    // window `persistMinted` leaves open. Resuming must find the stored
    // proofs rather than import them a second time.
    const operation = await onlyTopup(storage);
    await Effect.runPromise(
      storage.operations.update(operation.id, { status: "pending" }),
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
    expect(resumed.value.receipt?.operationId).toBe(
      done.value.receipt.operationId,
    );

    expect(await storedProofs(storage)).toHaveLength(2);
    expect((await onlyTopup(storage)).status).toBe("done");
  });

  it("fails with QuoteExpired and closes the operation once an unpaid quote expires", async () => {
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
    expect(await storedProofs(storage)).toEqual([]);
    expect((await onlyTopup(storage)).status).toBe("failed");
  });

  it("keeps the operation when the mint is unreachable across the deadline", async () => {
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
    expect(await pendingTopups(storage)).toHaveLength(1);
  });

  it("rescues a paid quote whose operation outlived its deadline", async () => {
    const storage = freshStorage();
    const expired = Math.floor(Date.now() / 1000) - 3600;
    // Crash window: the invoice was paid, but the process died before any
    // mint attempt reserved counters — the operation must not be pruned on
    // time.
    await writePendingTopup(storage, {
      counter: null,
      expiresAt: expired,
      createdAt: expired - 600,
    });

    const { wallet, mintCounters } = makeWallet({
      states: [quoteResponse("PAID")],
    });
    const resumed = await makeHarness(wallet, storage).run(resumeAndAwait);

    assert(Exit.isSuccess(resumed));
    expect(resumed.value.count).toBe(1);
    expect(resumed.value.receipt?.amount).toBe(16);
    expect(mintCounters).toEqual([1]);
    expect((await onlyTopup(storage)).status).toBe("done");
  });

  it("closes an expired operation once the mint confirms it unpaid on resume", async () => {
    const storage = freshStorage();
    const expired = Math.floor(Date.now() / 1000) - 3600;
    await writePendingTopup(storage, {
      counter: null,
      expiresAt: expired,
      createdAt: expired - 600,
    });

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
    expect((await onlyTopup(storage)).status).toBe("failed");
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
      probe: () =>
        Promise.resolve({ proofs: [], lastCounterWithSignature: 100 }),
    });
    const { run } = makeHarness(wallet, storage);

    const exit = await run(startAndAwait);

    assert(Exit.isSuccess(exit));
    expect(exit.value.receipt.amount).toBe(16);
    // The NUT-09 probe found signatures past the reserved block, so the retry
    // starts beyond them rather than at the block's end.
    expect(mintCounters).toEqual([1, 101]);
    expect(await onlyTopup(storage)).toMatchObject({
      status: "done",
      counter: 101,
    });
  });

  it("surfaces a definitive mint rejection and keeps the operation for a retry", async () => {
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
    // A reserved counter means the invoice was paid: the operation must
    // outlive the failure so the funds stay reclaimable.
    expect(await pendingTopups(storage)).toMatchObject([{ counter: 1 }]);
  });

  it.each(["QuoteExpired", "MintRejected", "MintUnreachable"])(
    "surfaces %s and cancels an unsettled NUT-17 subscription",
    async (errorTag) => {
      const storage = freshStorage();
      let checks = 0;
      let cancelled = 0;
      let disconnects = 0;
      const { wallet, mintCounters } = makeWallet({
        created: quoteResponse("UNPAID", 990),
        states: [],
        check: () => {
          checks += 1;
          if (errorTag === "MintRejected") {
            return Promise.reject(
              new MintOperationError(10000, "quote not found"),
            );
          }
          if (errorTag === "MintUnreachable") {
            return Promise.reject(new TypeError("Failed to fetch"));
          }
          return Promise.resolve(quoteResponse("UNPAID", 990));
        },
      });
      const { run } = makeHarness(
        fakeWallet({
          ...wallet,
          getMintInfo: () => new CashuMintInfo(websocketMintInfo()),
          mint: {
            ...wallet.mint,
            disconnectWebSocket: () => {
              disconnects += 1;
            },
          },
          on: {
            mintQuoteUpdates: () =>
              Promise.resolve(() => {
                cancelled += 1;
              }),
          },
        }),
        storage,
      );

      const exit = await run(
        Effect.gen(function* () {
          yield* TestClock.adjust("1000 seconds");
          return yield* runOnTestClock(
            Effect.gen(function* () {
              const outcome = yield* Effect.either(startAndAwait);
              // Capture cleanup before the outer scope closes.
              return { outcome, cancelled, disconnects };
            }).pipe(Effect.timeoutOption("60 seconds")),
            "5 seconds",
          );
        }).pipe(Effect.provide(TestContext.TestContext)),
      );

      assert(Exit.isSuccess(exit));
      assert(exit.value._tag === "Some");
      const result = exit.value.value;
      assert(result.outcome._tag === "Left");
      expect(result.outcome.left._tag).toBe(errorTag);
      expect(result.cancelled).toBe(1);
      expect(result.disconnects).toBe(1);
      expect(checks).toBe(errorTag === "MintUnreachable" ? 10 : 1);
      expect(mintCounters).toEqual([]);
      expect(await storedProofs(storage)).toEqual([]);
      expect((await onlyTopup(storage)).status).toBe(
        errorTag === "QuoteExpired" ? "failed" : "pending",
      );
    },
  );

  it("cancels both watchers when the topup scope closes", async () => {
    const storage = freshStorage();
    let checks = 0;
    let cancelled = 0;
    let disconnects = 0;
    const { wallet, mintCounters } = makeWallet({
      states: [],
      check: () => {
        checks += 1;
        return Promise.resolve(quoteResponse("UNPAID"));
      },
    });
    const { run } = makeHarness(
      fakeWallet({
        ...wallet,
        getMintInfo: () => new CashuMintInfo(websocketMintInfo()),
        mint: {
          ...wallet.mint,
          disconnectWebSocket: () => {
            disconnects += 1;
          },
        },
        on: {
          mintQuoteUpdates: () =>
            Promise.resolve(() => {
              cancelled += 1;
            }),
        },
      }),
      storage,
    );

    const exit = await run(
      Effect.gen(function* () {
        yield* TestClock.adjust("1000 seconds");
        yield* runOnTestClock(
          Effect.scoped(
            Effect.gen(function* () {
              yield* (yield* Topup).start(draft);
              yield* Effect.sleep("1 second");
            }),
          ),
          "1 second",
        );
        yield* TestClock.adjust("60 seconds");
      }).pipe(Effect.provide(TestContext.TestContext)),
    );

    assert(Exit.isSuccess(exit));
    expect(checks).toBe(1);
    expect(cancelled).toBe(1);
    expect(disconnects).toBe(1);
    expect(mintCounters).toEqual([]);
    expect(await pendingTopups(storage)).toHaveLength(1);
  });

  it("settles from a NUT-17 push without the poll ever seeing it paid", async () => {
    const storage = freshStorage();
    let cancelled = 0;
    let pushed = false;
    const { wallet, mintCounters } = makeWallet({
      states: [],
      // The mint answers UNPAID over HTTP until it has pushed the settlement,
      // so only the subscription can end this topup: the poll's next tick is
      // 30 s away and the test never moves the clock.
      check: () => Promise.resolve(quoteResponse(pushed ? "PAID" : "UNPAID")),
    });
    const { run, events } = makeHarness(
      fakeWallet({
        ...wallet,
        getMintInfo: () => new CashuMintInfo(websocketMintInfo()),
        on: {
          mintQuoteUpdates: (ids, onUpdate) => {
            expect(ids).toEqual([quoteId]);
            queueMicrotask(() => {
              // What the mint replays on subscribe: still unpaid, and the
              // topup must keep waiting rather than try to mint on it.
              onUpdate(quoteResponse("UNPAID"));
              pushed = true;
              onUpdate(quoteResponse("PAID"));
            });
            return Promise.resolve(() => {
              cancelled += 1;
            });
          },
        },
      }),
      storage,
    );

    const exit = await run(startAndAwait);

    assert(Exit.isSuccess(exit));
    expect(exit.value.receipt.amount).toBe(16);
    expect(mintCounters).toEqual([1]);
    expect(await pendingTopups(storage)).toEqual([]);
    // The socket is closed again once it has delivered.
    expect(cancelled).toBe(1);

    const paid = events.find(
      (event) => event._tag === "QuoteStateChanged" && event.state === "PAID",
    );
    assert(paid?._tag === "QuoteStateChanged");
    expect(paid.via).toBe("subscription");
  });

  it("falls back to the poll when the subscription cannot be established", async () => {
    const storage = freshStorage();
    const { wallet } = makeWallet({ states: [quoteResponse("PAID")] });
    const { run, events } = makeHarness(
      fakeWallet({
        ...wallet,
        getMintInfo: () => new CashuMintInfo(websocketMintInfo()),
        on: {
          mintQuoteUpdates: () => Promise.reject(new Error("socket refused")),
        },
      }),
      storage,
    );

    const exit = await run(
      Effect.gen(function* () {
        // The TestClock starts at 0, which is not a UnixSeconds.
        yield* TestClock.adjust("1000 seconds");
        return yield* runOnTestClock(startAndAwait, "5 seconds");
      }).pipe(Effect.provide(TestContext.TestContext)),
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value.receipt.amount).toBe(16);
    const paid = events.find(
      (event) => event._tag === "QuoteStateChanged" && event.state === "PAID",
    );
    assert(paid?._tag === "QuoteStateChanged");
    expect(paid.via).toBe("poll");
  });

  it("re-subscribes after the socket drops and settles on the replayed state", async () => {
    const storage = freshStorage();
    let subscriptions = 0;
    let pushed = false;
    const { wallet } = makeWallet({
      states: [],
      check: () => Promise.resolve(quoteResponse(pushed ? "PAID" : "UNPAID")),
    });
    const { run, events } = makeHarness(
      fakeWallet({
        ...wallet,
        getMintInfo: () => new CashuMintInfo(websocketMintInfo()),
        on: {
          mintQuoteUpdates: (_ids, onUpdate, onError) => {
            subscriptions += 1;
            const attempt = subscriptions;
            queueMicrotask(() => {
              if (attempt === 1) {
                // The OS tore the socket down while the app was backgrounded.
                onError(new Error("WebSocket closed (code 1006)"));
                return;
              }
              // The mint replays the state on subscribe, so the settlement
              // missed while disconnected arrives with the new subscription.
              pushed = true;
              onUpdate(quoteResponse("PAID"));
            });
            return Promise.resolve(() => undefined);
          },
        },
      }),
      storage,
    );

    const exit = await run(
      Effect.gen(function* () {
        yield* TestClock.adjust("1000 seconds");
        // Short enough that the poll never reaches its own next tick before
        // the backoff lets the second subscription through.
        return yield* runOnTestClock(startAndAwait, "1 second");
      }).pipe(Effect.provide(TestContext.TestContext)),
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value.receipt.amount).toBe(16);
    expect(subscriptions).toBeGreaterThanOrEqual(2);
    const paid = events.find(
      (event) => event._tag === "QuoteStateChanged" && event.state === "PAID",
    );
    assert(paid?._tag === "QuoteStateChanged");
    expect(paid.via).toBe("subscription");
  });

  it("closes the mint socket once the settled topup no longer needs it", async () => {
    const storage = freshStorage();
    let disconnects = 0;
    let pushed = false;
    const { wallet } = makeWallet({
      states: [],
      check: () => Promise.resolve(quoteResponse(pushed ? "PAID" : "UNPAID")),
    });
    const { run } = makeHarness(
      fakeWallet({
        ...wallet,
        getMintInfo: () => new CashuMintInfo(websocketMintInfo()),
        // cashu-ts shares one socket per mint and leaves it open; a plain-Node
        // consumer would never exit if the topup did not close it.
        mint: {
          ...wallet.mint,
          disconnectWebSocket: () => {
            disconnects += 1;
          },
        },
        on: {
          mintQuoteUpdates: (_ids, onUpdate) => {
            queueMicrotask(() => {
              pushed = true;
              onUpdate(quoteResponse("PAID"));
            });
            return Promise.resolve(() => undefined);
          },
        },
      }),
      storage,
    );

    const exit = await run(startAndAwait);

    assert(Exit.isSuccess(exit));
    expect(disconnects).toBe(1);
  });

  it("ignores a websocket that cannot push this method or unit", async () => {
    const storage = freshStorage();
    const { wallet } = makeWallet({ states: [quoteResponse("PAID")] });
    const { run } = makeHarness(
      fakeWallet({
        ...wallet,
        // Proof states only: nothing this topup could subscribe to.
        getMintInfo: () =>
          new CashuMintInfo(websocketMintInfo(["proof_state"])),
        on: {
          mintQuoteUpdates: () =>
            Promise.reject(new Error("must not subscribe")),
        },
      }),
      storage,
    );

    const exit = await run(startAndAwait);

    assert(Exit.isSuccess(exit));
    expect(exit.value.receipt.amount).toBe(16);
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
  it("mints a quote someone else paid into available proofs", async () => {
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

    expect(proofsIn(await storedProofs(storage), "available")).toHaveLength(2);
    expect(await onlyTopup(storage)).toMatchObject({
      id: exit.value.right.operationId,
      status: "done",
      locked: false,
    });
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
    expect((await onlyTopup(storage)).locked).toBe(true);
    // The key must never leave through the inspector or the store.
    expect(JSON.stringify(events)).not.toContain(lockingKey);
    expect(JSON.stringify(await topupOperations(storage))).not.toContain(
      lockingKey,
    );
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
    expect(await topupOperations(storage)).toEqual([]);
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
    expect(await topupOperations(storage)).toEqual([]);
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
    expect(await topupOperations(storage)).toEqual([]);
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
    expect(await pendingTopups(storage)).toMatchObject([
      { locked: true, counter: 1 },
    ]);

    // Without the key the resumed operation fails before any mint call and
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
    expect(await pendingTopups(storage)).toHaveLength(1);

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
    expect((await onlyTopup(storage)).status).toBe("done");
  });

  it("carries a legacy key-value record over into a topup operation", async () => {
    const storage = freshStorage();
    const legacyKey =
      LEGACY_PENDING_TOPUP_KEY_PREFIX +
      [mint, quoteId].map(encodeURIComponent).join(".");
    // Written before the `locked` flag existed, by an attempt that reserved
    // slot 1 and lost the mint's response.
    await Effect.runPromise(
      storage.kv.set(
        legacyKey,
        JSON.stringify({
          quoteId,
          mint,
          unit: "sat",
          keysetId: KEYSET_HEX,
          amount: 16,
          invoice,
          expiresAt: null,
          createdAt: Math.floor(Date.now() / 1000),
          mintCounter: 1,
        }),
      ),
    );
    const { wallet, mintCounters, restoreCalls } = makeWallet({
      states: [quoteResponse("ISSUED")],
      restore: () =>
        Promise.resolve({ proofs: mintedProofs, lastCounterWithSignature: 2 }),
    });
    const resumed = await makeHarness(wallet, storage).run(resumeAndAwait);

    assert(Exit.isSuccess(resumed));
    expect(resumed.value.receipt?.amount).toBe(16);
    // The carried-over slot is reclaimed, never minted again.
    expect(mintCounters).toEqual([]);
    expect(restoreCalls).toEqual([{ start: 1, count: 64 }]);
    expect(await onlyTopup(storage)).toMatchObject({
      kind: "topup",
      status: "done",
      mint,
      quoteId,
      amount: 16,
      counter: 1,
      locked: false,
    });
    expect(
      await Effect.runPromise(
        storage.kv.listKeys(LEGACY_PENDING_TOPUP_KEY_PREFIX),
      ),
    ).toEqual([]);
  });
});
