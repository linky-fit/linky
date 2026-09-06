import type {
  MintQuoteBolt11Response,
  Proof as CashuProof,
} from "@cashu/cashu-ts";
import {
  Amount as CashuAmount,
  getEncodedToken,
  MintOperationError,
} from "@cashu/cashu-ts";
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
  TokenText,
  UnixSeconds,
} from "../domain/primitives";
import { MeltReceipt } from "../melt/domain";
import type { MeltDraft } from "../melt/domain";
import { Melt } from "../melt/Melt";
import { WalletInstances } from "../mint/internal/WalletInstances";
import type { LoadedWallet } from "../mint/internal/WalletInstances";
import { KeyValueStore } from "../ports/KeyValueStore";
import type { KeyValueStoreService } from "../ports/KeyValueStore";
import { NewTokenRow, TokenStore } from "../ports/TokenStore";
import {
  answerProofStates,
  fakeWallet,
  KEYSET_HEX,
  proof,
} from "../testing/fakeWallet";
import { recordingInspector } from "../testing/inspector";
import { freshStorage } from "../testing/storage";
import type { Storage } from "../testing/storage";
import { Autoswap } from "./Autoswap";
import { AutoswapDraft } from "./domain";
import {
  PENDING_AUTOSWAP_CLAIM_KEY_PREFIX,
  PendingAutoswapClaim,
  pendingClaims,
} from "./internal/pendingClaim";

const sourceMint = MintUrl.make("https://source.example");
const targetMint = MintUrl.make("https://target.example");
const sat = CurrencyUnit.make("sat");
const draft = new AutoswapDraft({ sourceMint, targetMint });

const invoice = "lnbc1pexampleinvoice";
const targetQuoteId = "target-quote-1";

/** 100 sat sitting at the source mint. */
const sourceToken = getEncodedToken({
  mint: sourceMint,
  unit: "sat",
  proofs: [proof(64, "src-a"), proof(32, "src-b"), proof(4, "src-c")],
});

const mintedProofs = [proof(64, "tgt-a"), proof(32, "tgt-b")];

const mintQuoteResponse = (
  state: "UNPAID" | "PAID" | "ISSUED",
): MintQuoteBolt11Response => ({
  quote: targetQuoteId,
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
      createMintQuoteBolt11: (amount) => {
        quotedAmounts.push(typeof amount === "number" ? amount : -1);
        return Promise.resolve(mintQuoteResponse("UNPAID"));
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
        Layer.succeed(TokenStore, storage.tokens),
        inspector.layer,
      ),
    ),
  );
  const run = <A, E>(program: Effect.Effect<A, E, Autoswap>) =>
    Effect.runPromiseExit(program.pipe(Effect.provide(layer)));
  return { run, events: inspector.events, ...wallets };
};

const seedSourceRow = (storage: Storage) =>
  Effect.runPromise(
    storage.tokens.insert(
      new NewTokenRow({
        originalTokenText: TokenText.make(sourceToken),
        tokenText: TokenText.make(sourceToken),
        state: "accepted",
        error: null,
      }),
    ),
  );

const pendingKeys = (kv: KeyValueStoreService) =>
  Effect.runPromise(kv.listKeys(PENDING_AUTOSWAP_CLAIM_KEY_PREFIX));

const targetRows = (storage: Storage) =>
  Effect.runPromise(storage.tokens.loadAll).then((rows) =>
    rows.filter((row) => row.tokenText !== sourceToken),
  );

const pendingClaimRecord = (
  mintCounter: number | null,
  createdAt: number = Math.floor(Date.now() / 1000),
) =>
  new PendingAutoswapClaim({
    quoteId: QuoteId.make(targetQuoteId),
    mint: targetMint,
    unit: sat,
    keysetId: KeysetId.make(KEYSET_HEX),
    amount: Amount.make(96),
    invoice: Bolt11Invoice.make(invoice),
    sourceMint,
    createdAt: UnixSeconds.make(createdAt),
    mintCounter,
  });

const claimDraft = Effect.flatMap(Autoswap, (autoswap) =>
  autoswap.claim(draft),
);
const resume = Effect.flatMap(
  Autoswap,
  (autoswap) => autoswap.resumePendingClaims,
);

describe("Autoswap.claim", () => {
  it("melts the source balance into an accepted row at the target mint", async () => {
    const storage = freshStorage();
    await seedSourceRow(storage);
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

    const rows = await targetRows(storage);
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe("accepted");
    expect(rows[0].id).toBe(exit.value.rowId);
    // A finished claim leaves no pending work behind.
    expect(await pendingKeys(storage.kv)).toEqual([]);

    expect(
      harness.events.some(
        (event) =>
          event._tag === "QuoteStateChanged" && event.flow === "autoswap",
      ),
    ).toBe(true);
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
    await seedSourceRow(storage);
    // The first attempt learns the mint's 5 sat fee reserve the hard way.
    const melt = makeMelt([() => short(105), paidReceipt]);
    const harness = makeHarness(storage, { states: ["PAID"] }, melt);

    const exit = await harness.run(claimDraft);

    assert(Exit.isSuccess(exit));
    expect(harness.quotedAmounts).toEqual([100, 95]);
    expect(melt.invoices).toHaveLength(2);
    // The abandoned attempt's record is gone: nothing was ever paid for it.
    expect(await pendingKeys(storage.kv)).toEqual([]);
  });

  it("fails with InsufficientFunds when fees eat the whole balance", async () => {
    const storage = freshStorage();
    await seedSourceRow(storage);
    const melt = makeMelt([() => short(100_000)]);
    const harness = makeHarness(storage, { states: ["PAID"] }, melt);

    const exit = await harness.run(Effect.either(claimDraft));

    assert(Exit.isSuccess(exit));
    assert(exit.value._tag === "Left");
    expect(exit.value.left._tag).toBe("InsufficientFunds");
    expect(await pendingKeys(storage.kv)).toEqual([]);
    expect(await targetRows(storage)).toEqual([]);
  });

  it("keeps the claim when the melt paid but the mint response was lost", async () => {
    const storage = freshStorage();
    await seedSourceRow(storage);
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
    // The funds are at the target mint; the record is what gets them out.
    expect(await pendingKeys(storage.kv)).toHaveLength(1);
    expect(await targetRows(storage)).toEqual([]);
  });
});

describe("Autoswap.resumePendingClaims", () => {
  it("finishes an interrupted claim on a fresh runtime without minting twice", async () => {
    const storage = freshStorage();
    await seedSourceRow(storage);

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
    expect(await pendingKeys(storage.kv)).toHaveLength(1);

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
    expect(exit.value[0].status).toBe("claimed");
    expect(exit.value[0].amount).toBe(96);
    expect(second.mintCounters).toEqual([]);
    expect(second.restoreCalls).toEqual([{ start: 1, count: 64 }]);

    const rows = await targetRows(storage);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(exit.value[0].rowId);
    expect(await pendingKeys(storage.kv)).toEqual([]);

    // Run three: the record is gone, so there is nothing left to claim.
    const third = makeHarness(storage, { states: ["ISSUED"] }, makeMelt([]));
    const again = await third.run(resume);
    assert(Exit.isSuccess(again));
    expect(again.value).toEqual([]);
    expect(await targetRows(storage)).toHaveLength(1);
  });

  it("resolves to the stored row when the proofs landed before the crash", async () => {
    const storage = freshStorage();
    await seedSourceRow(storage);
    const done = await makeHarness(
      storage,
      { states: ["PAID"] },
      makeMelt([paidReceipt]),
    ).run(claimDraft);
    assert(Exit.isSuccess(done));

    // The row was written but the record never cleared — the one window the
    // claim leaves open. Resuming must find the stored proofs.
    await Effect.runPromise(
      pendingClaims.write(storage.kv, pendingClaimRecord(1)),
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
    expect(exit.value[0].status).toBe("claimed");
    expect(exit.value[0].rowId).toBe(done.value.rowId);
    expect(await targetRows(storage)).toHaveLength(1);
    expect(await pendingKeys(storage.kv)).toEqual([]);
  });

  it("keeps an unpaid quote for the next pass", async () => {
    const storage = freshStorage();
    await Effect.runPromise(
      pendingClaims.write(storage.kv, pendingClaimRecord(null)),
    );

    const harness = makeHarness(storage, { states: ["UNPAID"] }, makeMelt([]));
    const exit = await harness.run(resume);

    assert(Exit.isSuccess(exit));
    expect(exit.value[0].status).toBe("not-claimable-yet");
    expect(harness.mintCounters).toEqual([]);
    expect(await pendingKeys(storage.kv)).toHaveLength(1);
  });

  it("keeps a fresh record even when the mint rejects the quote check", async () => {
    const storage = freshStorage();
    await Effect.runPromise(
      pendingClaims.write(storage.kv, pendingClaimRecord(1)),
    );

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
    expect(exit.value[0].status).toBe("not-claimable-yet");
    // The mint refusing to answer says nothing about proofs it may have
    // signed; only the claim's own rejection may retire the record early.
    expect(await pendingKeys(storage.kv)).toHaveLength(1);
    expect(harness.mintCounters).toEqual([]);
  });

  it("keeps a claim past its deadline while the mint is unreachable", async () => {
    const storage = freshStorage();
    const dayOld = Math.floor(Date.now() / 1000) - 25 * 3600;
    await Effect.runPromise(
      pendingClaims.write(storage.kv, pendingClaimRecord(1, dayOld)),
    );

    const harness = makeHarness(
      storage,
      { check: () => Promise.reject(new TypeError("Failed to fetch")) },
      makeMelt([]),
    );
    const exit = await harness.run(resume);

    assert(Exit.isSuccess(exit));
    expect(exit.value[0].status).toBe("not-claimable-yet");
    // No answer from the mint says nothing about the quote; only a
    // mint-confirmed UNPAID may retire a record on the local clock.
    expect(await pendingKeys(storage.kv)).toHaveLength(1);
  });

  it("retires an unpaid claim once it outlives its deadline", async () => {
    const storage = freshStorage();
    const dayOld = Math.floor(Date.now() / 1000) - 25 * 3600;
    await Effect.runPromise(
      pendingClaims.write(storage.kv, pendingClaimRecord(null, dayOld)),
    );

    const harness = makeHarness(storage, { states: ["UNPAID"] }, makeMelt([]));
    const exit = await harness.run(resume);

    assert(Exit.isSuccess(exit));
    // The melt that should have paid this invoice never happened.
    expect(exit.value[0].status).toBe("dropped");
    expect(await pendingKeys(storage.kv)).toEqual([]);
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
    // fresh record survives it for the next pass.
    const fresh = freshStorage();
    await Effect.runPromise(
      pendingClaims.write(fresh.kv, pendingClaimRecord(1)),
    );
    const kept = await rejecting(fresh).run(resume);
    assert(Exit.isSuccess(kept));
    expect(kept.value[0].status).toBe("not-claimable-yet");
    expect(await pendingKeys(fresh.kv)).toHaveLength(1);

    // After a day of the mint rejecting the claim, deterministic recovery is
    // exhausted; retrying forever would only repeat the same rejection.
    const aged = freshStorage();
    const dayOld = Math.floor(Date.now() / 1000) - 25 * 3600;
    await Effect.runPromise(
      pendingClaims.write(aged.kv, pendingClaimRecord(1, dayOld)),
    );
    const exit = await rejecting(aged).run(resume);
    assert(Exit.isSuccess(exit));
    expect(exit.value[0].status).toBe("dropped");
    expect(exit.value[0].rowId).toBeNull();
    expect(await pendingKeys(aged.kv)).toEqual([]);
  });
});
