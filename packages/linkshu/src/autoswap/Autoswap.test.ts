import type {
  MintQuoteBolt11Response,
  Proof as CashuProof,
} from "@cashu/cashu-ts";
import { Amount as CashuAmount, MintOperationError } from "@cashu/cashu-ts";
import { Effect, Exit, Layer } from "effect";
import { InsufficientFunds } from "../domain/errors";
import {
  Amount,
  Bolt11Invoice,
  CurrencyUnit,
  KeysetId,
  MintUrl,
  NonNegativeAmount,
  QuoteId,
  UnixSeconds,
} from "../domain/primitives";
import { MeltReceipt } from "../melt/domain";
import type { MeltDraft } from "../melt/domain";
import { Melt } from "../melt/Melt";
import { WalletInstances } from "../mint/internal/WalletInstances";
import type { LoadedWallet } from "../mint/internal/WalletInstances";
import { KeyValueStore } from "../ports/KeyValueStore";
import { OperationStore } from "../ports/OperationStore";
import type { StoredOperation } from "../ports/OperationStore";
import { ProofStore } from "../ports/ProofStore";
import {
  answerProofStates,
  fakeWallet,
  KEYSET_HEX,
  proof,
} from "../testing/fakeWallet";
import { recordingInspector } from "../testing/inspector";
import { seedProofs } from "../testing/inventory";
import { freshStorage } from "../testing/storage";
import type { Storage } from "../testing/storage";
import { Autoswap } from "./Autoswap";
import { AutoswapDraft } from "./domain";
import { autoswapRecords } from "./internal/autoswapRecords";

const sourceMint = MintUrl.make("https://source.example");
const targetMint = MintUrl.make("https://target.example");
const sat = CurrencyUnit.make("sat");
const draft = new AutoswapDraft({ sourceMint, targetMint });

const invoice = "lnbc1pexampleinvoice";
const targetQuoteId = "target-quote-1";

const LEGACY_PENDING_CLAIM_KEY_PREFIX = "linkshu.pendingAutoswapClaim.";

/** 100 sat sitting at the source mint. */
const sourceProofs = [
  proof(64, "src-a"),
  proof(32, "src-b"),
  proof(4, "src-c"),
];

const mintedProofs = [proof(64, "tgt-a"), proof(32, "tgt-b")];

const mintQuoteResponse = (
  state: "UNPAID" | "PAID" | "ISSUED",
  quote: string = targetQuoteId,
): MintQuoteBolt11Response => ({
  quote,
  request: invoice,
  unit: "sat",
  amount: CashuAmount.from(96),
  state,
  expiry: null,
});

interface FakeWalletArgs {
  /** One entry per `checkMintQuoteBolt11` call; the last one repeats. */
  readonly states?: ReadonlyArray<"UNPAID" | "PAID" | "ISSUED">;
  /** Replaces the state sequence entirely when set. */
  readonly check?: () => Promise<MintQuoteBolt11Response>;
  readonly mintProofs?: (counter: number) => Promise<CashuProof[]>;
  readonly restore?: () => Promise<{
    proofs: CashuProof[];
    lastCounterWithSignature?: number;
  }>;
}

const makeWallets = (args: FakeWalletArgs) => {
  const quotedAmounts: number[] = [];
  const mintCounters: number[] = [];
  const restoreCalls: Array<{ start: number; count: number }> = [];
  let checks = 0;
  const wallet = (): LoadedWallet =>
    fakeWallet({
      keysetId: KEYSET_HEX,
      checkProofsStates: answerProofStates(),
      // Every quote gets its own id, so each sizing attempt is its own
      // operation: target-quote-1, target-quote-2, ...
      createMintQuoteBolt11: (amount) => {
        quotedAmounts.push(typeof amount === "number" ? amount : -1);
        return Promise.resolve(
          mintQuoteResponse("UNPAID", `target-quote-${quotedAmounts.length}`),
        );
      },
      checkMintQuoteBolt11: () => {
        if (args.check !== undefined) return args.check();
        const states = args.states ?? ["PAID"];
        const state = states[Math.min(checks, states.length - 1)] ?? "PAID";
        checks += 1;
        return Promise.resolve(mintQuoteResponse(state));
      },
      mintProofsBolt11: (_amount, _quote, _config, outputType) => {
        const counter =
          outputType?.type === "deterministic" ? outputType.counter : -1;
        mintCounters.push(counter);
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
  return { wallet, quotedAmounts, mintCounters, restoreCalls };
};

/** The melt vertical stands in for the source-side payment under test. */
const makeMelt = (
  outcomes: ReadonlyArray<
    (amountPaid: number) => Effect.Effect<MeltReceipt, InsufficientFunds>
  >,
) => {
  const invoices: string[] = [];
  const service = Melt.make({
    status: () => Effect.succeed("UNPAID"),
    quote: () => Effect.die("melt.quote not under test"),
    resumePending: Effect.succeed([]),
    melt: (draft: MeltDraft) => {
      const index = invoices.length;
      invoices.push(draft.invoice);
      const outcome = outcomes[Math.min(index, outcomes.length - 1)];
      if (outcome === undefined) return Effect.die("no melt outcome");
      return outcome(index);
    },
  });
  return { service, invoices };
};

const paidReceipt = (): Effect.Effect<MeltReceipt, InsufficientFunds> =>
  Effect.succeed(
    new MeltReceipt({
      mint: sourceMint,
      quoteId: QuoteId.make("melt-quote-1"),
      paidAmount: Amount.make(96),
      feeReserve: NonNegativeAmount.make(4),
      feePaid: NonNegativeAmount.make(2),
      changeAmount: NonNegativeAmount.make(0),
    }),
  );

/** What `Melt` reports when the invoice is priced above the balance. */
const short = (
  required: number,
): Effect.Effect<MeltReceipt, InsufficientFunds> =>
  Effect.fail(
    new InsufficientFunds({
      mint: sourceMint,
      required: Amount.make(required),
      available: NonNegativeAmount.make(100),
    }),
  );

/** One runtime over the given storage — a second one models a restart. */
const makeHarness = (
  storage: Storage,
  walletArgs: FakeWalletArgs,
  melt: ReturnType<typeof makeMelt>,
) => {
  const inspector = recordingInspector();
  const wallets = makeWallets(walletArgs);
  const layer = Autoswap.DefaultWithoutDependencies.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        Layer.succeed(
          WalletInstances,
          WalletInstances.make({
            get: () => Effect.succeed(wallets.wallet()),
          }),
        ),
        Layer.succeed(Melt, melt.service),
        Layer.succeed(KeyValueStore, storage.kv),
        Layer.succeed(ProofStore, storage.proofs),
        Layer.succeed(OperationStore, storage.operations),
        inspector.layer,
      ),
    ),
  );
  const run = <A, E>(program: Effect.Effect<A, E, Autoswap>) =>
    Effect.runPromiseExit(program.pipe(Effect.provide(layer)));
  return { run, events: inspector.events, ...wallets };
};

const seedSource = (storage: Storage) =>
  Effect.runPromise(
    seedProofs(sourceMint, sourceProofs).pipe(
      Effect.provide(Layer.succeed(ProofStore, storage.proofs)),
    ),
  );

const claimOperations = (storage: Storage) =>
  Effect.runPromise(storage.operations.loadAll).then((operations) =>
    operations.filter((operation) => operation.kind === "autoswap"),
  );

const pendingClaims = (storage: Storage) =>
  claimOperations(storage).then((operations) =>
    operations.filter((operation) => operation.status === "pending"),
  );

const onlyClaim = async (storage: Storage): Promise<StoredOperation> => {
  const operations = await claimOperations(storage);
  expect(operations).toHaveLength(1);
  const [only] = operations;
  assert(only !== undefined);
  return only;
};

const targetProofs = (storage: Storage) =>
  Effect.runPromise(storage.proofs.loadAll).then((proofs) =>
    proofs.filter((proof) => proof.mint === targetMint),
  );

/** A pending `autoswap` operation written the way the flow writes its own. */
const writePendingClaim = (
  storage: Storage,
  counter: number | null,
  createdAt: number = Math.floor(Date.now() / 1000),
) =>
  Effect.runPromise(
    autoswapRecords({
      kv: storage.kv,
      operationStore: storage.operations,
      inspector: recordingInspector().service,
    }).create({
      quoteId: QuoteId.make(targetQuoteId),
      mint: targetMint,
      unit: sat,
      keysetId: KeysetId.make(KEYSET_HEX),
      amount: Amount.make(96),
      invoice: Bolt11Invoice.make(invoice),
      sourceMint,
      expiresAt: null,
      createdAt: UnixSeconds.make(createdAt),
      counter,
    }),
  );

const claimDraft = Effect.flatMap(Autoswap, (autoswap) =>
  autoswap.claim(draft),
);
const resume = Effect.flatMap(
  Autoswap,
  (autoswap) => autoswap.resumePendingClaims,
);

describe("Autoswap.claim", () => {
  it("melts the source balance into available proofs at the target mint", async () => {
    const storage = freshStorage();
    await seedSource(storage);
    const melt = makeMelt([paidReceipt]);
    const harness = makeHarness(storage, { states: ["PAID"] }, melt);

    const exit = await harness.run(claimDraft);

    assert(Exit.isSuccess(exit));
    expect(exit.value.sourceMint).toBe(sourceMint);
    expect(exit.value.targetMint).toBe(targetMint);
    expect(exit.value.movedAmount).toBe(96);
    expect(exit.value.feePaid).toBe(2);

    // The whole spendable balance was quoted at the target, and the invoice
    // it produced is the one the melt paid.
    expect(harness.quotedAmounts).toEqual([100]);
    expect(melt.invoices).toEqual([invoice]);

    const proofs = await targetProofs(storage);
    expect(proofs).toHaveLength(2);
    expect(proofs.every((proof) => proof.state === "available")).toBe(true);
    // A finished claim leaves no pending work behind.
    expect(await onlyClaim(storage)).toMatchObject({
      id: exit.value.operationId,
      status: "done",
      sourceMint,
      counter: 1,
    });

    expect(
      harness.events.some(
        (event) =>
          event._tag === "QuoteStateChanged" && event.flow === "autoswap",
      ),
    ).toBe(true);
    expect(harness.events).toContainEqual(
      expect.objectContaining({
        _tag: "ProofsChanged",
        mint: targetMint,
        to: "available",
        amount: 96,
        reason: "autoswap",
      }),
    );
    expect(
      harness.events.some(
        (event) =>
          event._tag === "OperationSucceeded" &&
          event.name === "autoswap.claim",
      ),
    ).toBe(true);
  });

  it("steps the amount down by the shortfall the melt reports", async () => {
    const storage = freshStorage();
    await seedSource(storage);
    // The first attempt learns the mint's 5 sat fee reserve the hard way.
    const melt = makeMelt([() => short(105), paidReceipt]);
    const harness = makeHarness(storage, { states: ["PAID"] }, melt);

    const exit = await harness.run(claimDraft);

    assert(Exit.isSuccess(exit));
    expect(harness.quotedAmounts).toEqual([100, 95]);
    expect(melt.invoices).toHaveLength(2);
    // The abandoned attempt's operation is closed: nothing was ever paid
    // for it. The second one carried the funds.
    expect(await claimOperations(storage)).toMatchObject([
      { quoteId: "target-quote-1", amount: 100, status: "failed" },
      { quoteId: "target-quote-2", amount: 95, status: "done" },
    ]);
  });

  it("fails with InsufficientFunds when fees eat the whole balance", async () => {
    const storage = freshStorage();
    await seedSource(storage);
    const melt = makeMelt([() => short(100_000)]);
    const harness = makeHarness(storage, { states: ["PAID"] }, melt);

    const exit = await harness.run(Effect.either(claimDraft));

    assert(Exit.isSuccess(exit));
    assert(exit.value._tag === "Left");
    expect(exit.value.left._tag).toBe("InsufficientFunds");
    expect(await pendingClaims(storage)).toEqual([]);
    expect(
      (await claimOperations(storage)).every(
        (operation) => operation.status === "failed",
      ),
    ).toBe(true);
    expect(await targetProofs(storage)).toEqual([]);
  });

  it("keeps the claim when the melt paid but the mint response was lost", async () => {
    const storage = freshStorage();
    await seedSource(storage);
    const melt = makeMelt([paidReceipt]);
    const harness = makeHarness(
      storage,
      {
        states: ["PAID"],
        mintProofs: () => Promise.reject(new TypeError("Failed to fetch")),
      },
      melt,
    );

    const exit = await harness.run(Effect.either(claimDraft));

    assert(Exit.isSuccess(exit));
    assert(exit.value._tag === "Left");
    expect(exit.value.left._tag).toBe("MintUnreachable");
    // The funds are at the target mint; the operation is what gets them out.
    expect(await pendingClaims(storage)).toMatchObject([{ counter: 1 }]);
    expect(await targetProofs(storage)).toEqual([]);
  });
});

describe("Autoswap.resumePendingClaims", () => {
  it("finishes an interrupted claim on a fresh runtime without minting twice", async () => {
    const storage = freshStorage();
    await seedSource(storage);

    // Run one: the melt pays, then the mint response is lost in transit.
    const first = makeHarness(
      storage,
      {
        states: ["PAID"],
        mintProofs: () => Promise.reject(new TypeError("Failed to fetch")),
      },
      makeMelt([paidReceipt]),
    );
    assert(Exit.isSuccess(await first.run(Effect.either(claimDraft))));
    expect(first.mintCounters).toEqual([1]);
    expect(await pendingClaims(storage)).toHaveLength(1);

    // Run two: nothing in memory, the same storage. The mint already issued
    // the quote, so the reserved slots restore instead of minting again.
    const second = makeHarness(
      storage,
      {
        states: ["ISSUED"],
        restore: () =>
          Promise.resolve({
            proofs: mintedProofs,
            lastCounterWithSignature: 2,
          }),
      },
      makeMelt([paidReceipt]),
    );
    const exit = await second.run(resume);

    assert(Exit.isSuccess(exit));
    expect(exit.value).toHaveLength(1);
    expect(exit.value[0]).toMatchObject({ status: "claimed", amount: 96 });
    expect(second.mintCounters).toEqual([]);
    expect(second.restoreCalls).toEqual([{ start: 1, count: 64 }]);

    expect(await targetProofs(storage)).toHaveLength(2);
    expect(await onlyClaim(storage)).toMatchObject({
      id: exit.value[0]?.operationId,
      status: "done",
    });

    // Run three: the operation is closed, so there is nothing left to claim.
    const third = makeHarness(storage, { states: ["ISSUED"] }, makeMelt([]));
    const again = await third.run(resume);
    assert(Exit.isSuccess(again));
    expect(again.value).toEqual([]);
    expect(await targetProofs(storage)).toHaveLength(2);
  });

  it("resolves to the stored proofs when they landed before the crash", async () => {
    const storage = freshStorage();
    await seedSource(storage);
    const done = await makeHarness(
      storage,
      { states: ["PAID"] },
      makeMelt([paidReceipt]),
    ).run(claimDraft);
    assert(Exit.isSuccess(done));

    // The proofs were written but the operation never closed — the one
    // window the claim leaves open. Resuming must find the stored proofs.
    await Effect.runPromise(
      storage.operations.update(done.value.operationId, { status: "pending" }),
    );

    const resuming = makeHarness(
      storage,
      {
        states: ["ISSUED"],
        restore: () =>
          Promise.resolve({
            proofs: mintedProofs,
            lastCounterWithSignature: 2,
          }),
      },
      makeMelt([]),
    );
    const exit = await resuming.run(resume);

    assert(Exit.isSuccess(exit));
    expect(exit.value[0]).toMatchObject({
      status: "claimed",
      operationId: done.value.operationId,
    });
    expect(resuming.mintCounters).toEqual([]);
    expect(await targetProofs(storage)).toHaveLength(2);
    expect((await onlyClaim(storage)).status).toBe("done");
  });

  it("keeps an unpaid quote for the next pass", async () => {
    const storage = freshStorage();
    await writePendingClaim(storage, null);

    const harness = makeHarness(storage, { states: ["UNPAID"] }, makeMelt([]));
    const exit = await harness.run(resume);

    assert(Exit.isSuccess(exit));
    expect(exit.value[0]?.status).toBe("not-claimable-yet");
    expect(harness.mintCounters).toEqual([]);
    expect(await pendingClaims(storage)).toHaveLength(1);
  });

  it("keeps a fresh operation even when the mint rejects the quote check", async () => {
    const storage = freshStorage();
    await writePendingClaim(storage, 1);

    const harness = makeHarness(
      storage,
      {
        check: () =>
          Promise.reject(new MintOperationError(20001, "quote not found")),
      },
      makeMelt([]),
    );
    const exit = await harness.run(resume);

    assert(Exit.isSuccess(exit));
    expect(exit.value[0]?.status).toBe("not-claimable-yet");
    // The mint refusing to answer says nothing about proofs it may have
    // signed; only the claim's own rejection may retire the operation early.
    expect(await pendingClaims(storage)).toHaveLength(1);
    expect(harness.mintCounters).toEqual([]);
  });

  it("keeps a claim past its deadline while the mint is unreachable", async () => {
    const storage = freshStorage();
    const dayOld = Math.floor(Date.now() / 1000) - 25 * 3600;
    await writePendingClaim(storage, 1, dayOld);

    const harness = makeHarness(
      storage,
      { check: () => Promise.reject(new TypeError("Failed to fetch")) },
      makeMelt([]),
    );
    const exit = await harness.run(resume);

    assert(Exit.isSuccess(exit));
    expect(exit.value[0]?.status).toBe("not-claimable-yet");
    // No answer from the mint says nothing about the quote; only a
    // mint-confirmed UNPAID may retire an operation on the local clock.
    expect(await pendingClaims(storage)).toHaveLength(1);
  });

  it("retires an unpaid claim once it outlives its deadline", async () => {
    const storage = freshStorage();
    const dayOld = Math.floor(Date.now() / 1000) - 25 * 3600;
    await writePendingClaim(storage, null, dayOld);

    const harness = makeHarness(storage, { states: ["UNPAID"] }, makeMelt([]));
    const exit = await harness.run(resume);

    assert(Exit.isSuccess(exit));
    // The melt that should have paid this invoice never happened.
    expect(exit.value[0]?.status).toBe("dropped");
    expect((await onlyClaim(storage)).status).toBe("failed");
  });

  it("keeps a fresh claim through a rejection, drops it past the deadline", async () => {
    const rejecting = (storage: Storage) =>
      makeHarness(
        storage,
        {
          states: ["PAID"],
          mintProofs: () =>
            Promise.reject(
              new MintOperationError(20002, "quote already issued"),
            ),
        },
        makeMelt([]),
      );

    // A rejection may be transient (a 4xx classifies the same way), so a
    // fresh operation survives it for the next pass.
    const fresh = freshStorage();
    await writePendingClaim(fresh, 1);
    const kept = await rejecting(fresh).run(resume);
    assert(Exit.isSuccess(kept));
    expect(kept.value[0]?.status).toBe("not-claimable-yet");
    expect(await pendingClaims(fresh)).toHaveLength(1);

    // After a day of the mint rejecting the claim, deterministic recovery is
    // exhausted; retrying forever would only repeat the same rejection.
    const aged = freshStorage();
    const dayOld = Math.floor(Date.now() / 1000) - 25 * 3600;
    await writePendingClaim(aged, 1, dayOld);
    const exit = await rejecting(aged).run(resume);
    assert(Exit.isSuccess(exit));
    expect(exit.value[0]).toMatchObject({ status: "dropped", amount: null });
    expect((await onlyClaim(aged)).status).toBe("failed");
  });

  it("carries a legacy key-value record over into an autoswap operation", async () => {
    const storage = freshStorage();
    const legacyKey =
      LEGACY_PENDING_CLAIM_KEY_PREFIX +
      [targetMint, targetQuoteId].map(encodeURIComponent).join(".");
    // Written by a claim that reserved slot 1 and lost the mint's response;
    // the legacy shape carried no expiry.
    await Effect.runPromise(
      storage.kv.set(
        legacyKey,
        JSON.stringify({
          quoteId: targetQuoteId,
          mint: targetMint,
          unit: "sat",
          keysetId: KEYSET_HEX,
          amount: 96,
          invoice,
          sourceMint,
          createdAt: Math.floor(Date.now() / 1000),
          mintCounter: 1,
        }),
      ),
    );

    const harness = makeHarness(
      storage,
      {
        states: ["ISSUED"],
        restore: () =>
          Promise.resolve({
            proofs: mintedProofs,
            lastCounterWithSignature: 2,
          }),
      },
      makeMelt([]),
    );
    const exit = await harness.run(resume);

    assert(Exit.isSuccess(exit));
    expect(exit.value[0]).toMatchObject({
      status: "claimed",
      targetMint,
      quoteId: targetQuoteId,
      amount: 96,
    });
    // The carried-over slot is reclaimed, never minted again.
    expect(harness.mintCounters).toEqual([]);
    expect(harness.restoreCalls).toEqual([{ start: 1, count: 64 }]);
    expect(await targetProofs(storage)).toHaveLength(2);
    expect(await onlyClaim(storage)).toMatchObject({
      id: exit.value[0]?.operationId,
      kind: "autoswap",
      status: "done",
      mint: targetMint,
      sourceMint,
      quoteId: targetQuoteId,
      amount: 96,
      counter: 1,
      expiresAt: null,
    });
    expect(
      await Effect.runPromise(
        storage.kv.listKeys(LEGACY_PENDING_CLAIM_KEY_PREFIX),
      ),
    ).toEqual([]);
  });
});
