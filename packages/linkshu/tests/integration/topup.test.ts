import { Mint, Wallet } from "@cashu/cashu-ts";
import type { MintQuoteBolt11Response } from "@cashu/cashu-ts";
import { Effect } from "effect";
import { createECDH } from "node:crypto";
import {
  Amount,
  Bolt11Invoice,
  CurrencyUnit,
  PaidQuoteDraft,
  QuoteId,
  QuoteLockingKey,
  Send,
  SendDraft,
  Topup,
  TopupDraft,
  UnixSeconds,
  runLinkshu,
} from "../../src";
import { supportsMintQuoteSubscription } from "../../src/internal/quoteSubscription";
import {
  availableTotalOf,
  durableStorage,
  loadMintWallet,
  mintUrl,
  pendingOperations,
  randomSeed,
} from "./helpers";

describe("topup vertical against the local mint", () => {
  it("drives quote, poll, and mint into available proofs", async () => {
    const { proofs, operations, layers } = durableStorage();

    const { quote, receipt } = await runLinkshu(
      { bip39Seed: randomSeed(), ...layers },
      Effect.scoped(
        Effect.gen(function* () {
          const handle = yield* (yield* Topup).start(
            new TopupDraft({ mint: mintUrl, amount: Amount.make(32) }),
          );
          return { quote: handle.quote, receipt: yield* handle.result };
        }),
      ),
    );

    expect(quote.mint).toBe(mintUrl);
    expect(quote.invoice.toLowerCase().startsWith("ln")).toBe(true);
    expect(quote.amount).toBe(32);

    expect(receipt.quoteId).toBe(quote.quoteId);
    expect(receipt.amount).toBe(32);
    expect(receipt.tokenText.startsWith("cashu")).toBe(true);

    const stored = await Effect.runPromise(proofs.loadAll);
    expect(stored.length).toBeGreaterThan(0);
    expect(stored.every((proof) => proof.state === "available")).toBe(true);
    expect(availableTotalOf(stored)).toBe(32);

    // The topup is closed; a finished topup leaves no pending work behind.
    const topups = await Effect.runPromise(operations.loadAll);
    expect(topups).toHaveLength(1);
    expect(topups[0]).toMatchObject({
      id: receipt.operationId,
      kind: "topup",
      status: "done",
      quoteId: quote.quoteId,
    });
    expect(await pendingOperations(operations, "topup")).toEqual([]);
  });

  it("resumes a topup interrupted after quote creation and spends the result", async () => {
    const seed = randomSeed();
    const { proofs, operations, layers } = durableStorage();

    // Run one: the quote is created and persisted, then the runtime dies —
    // closing the scope interrupts the poll before it can mint anything.
    const quote = await runLinkshu(
      { bip39Seed: seed, ...layers },
      Effect.scoped(
        Effect.map(
          Effect.flatMap(Topup, (topup) =>
            topup.start(
              new TopupDraft({ mint: mintUrl, amount: Amount.make(64) }),
            ),
          ),
          (handle) => handle.quote,
        ),
      ),
    );

    expect(quote.invoice.toLowerCase().startsWith("ln")).toBe(true);
    expect(await Effect.runPromise(proofs.loadAll)).toEqual([]);
    const pending = await pendingOperations(operations, "topup");
    expect(pending).toHaveLength(1);
    expect(pending[0]?.quoteId).toBe(quote.quoteId);

    // Run two: nothing in memory, the same storage. The invoice settled while
    // nobody was watching, and the topup finishes itself.
    const { resumed, receipt, sent } = await runLinkshu(
      { bip39Seed: seed, ...layers },
      Effect.scoped(
        Effect.gen(function* () {
          const handles = yield* (yield* Topup).resumePending();
          const first = handles[0];
          if (first === undefined) throw new Error("no pending topup resumed");
          const receipt = yield* first.result;
          // The counter must be past the minted slots, or this collides.
          const sent = yield* (yield* Send).send(
            new SendDraft({
              mint: mintUrl,
              amount: Amount.make(8),
              produceAs: "issued",
            }),
          );
          return { resumed: handles.length, receipt, sent };
        }),
      ),
    );

    expect(resumed).toBe(1);
    expect(receipt.quoteId).toBe(quote.quoteId);
    expect(receipt.amount).toBe(64);
    expect(sent.amount).toBe(8);

    // The topup is closed and the funds are proofs, not a dangling quote.
    expect(await pendingOperations(operations, "topup")).toEqual([]);
    expect(availableTotalOf(await Effect.runPromise(proofs.loadAll))).toBe(
      64 - 8 - sent.feePaid,
    );
  });

  it("resumes the same quote rather than minting it twice", async () => {
    const seed = randomSeed();
    const { proofs, operations, layers } = durableStorage();

    const quote = await runLinkshu(
      { bip39Seed: seed, ...layers },
      Effect.scoped(
        Effect.map(
          Effect.flatMap(Topup, (topup) =>
            topup.start(
              new TopupDraft({ mint: mintUrl, amount: Amount.make(16) }),
            ),
          ),
          (handle) => handle.quote,
        ),
      ),
    );

    const resumeOnce = () =>
      runLinkshu(
        { bip39Seed: seed, ...layers },
        Effect.scoped(
          Effect.gen(function* () {
            const handles = yield* (yield* Topup).resumePending();
            const first = handles[0];
            return first === undefined ? null : yield* first.result;
          }),
        ),
      );

    const first = await resumeOnce();
    expect(first?.quoteId).toBe(quote.quoteId);
    expect(first?.amount).toBe(16);

    // The topup is closed, so a second resume has nothing left to claim and
    // the 16 sats are minted exactly once.
    expect(await resumeOnce()).toBeNull();
    expect(await pendingOperations(operations, "topup")).toEqual([]);
    expect(availableTotalOf(await Effect.runPromise(proofs.loadAll))).toBe(16);
  });
});

// A quote created by someone else (here: directly through cashu-ts, standing
// in for an npub.cash server) and settled by the FakeWallet backend.
describe("adopting externally paid quotes against the local mint", () => {
  const loadWallet = async () => {
    const wallet = new Wallet(new Mint(mintUrl), { unit: "sat" });
    await wallet.loadMint();
    return wallet;
  };

  const secp256k1Keypair = () => {
    const ecdh = createECDH("secp256k1");
    ecdh.generateKeys();
    return {
      privkey: QuoteLockingKey.make(
        ecdh.getPrivateKey("hex").padStart(64, "0"),
      ),
      pubkey: ecdh.getPublicKey("hex", "compressed"),
    };
  };

  const draftOf = (
    quote: MintQuoteBolt11Response,
    amount: number,
    locked: boolean,
  ) =>
    new PaidQuoteDraft({
      quoteId: QuoteId.make(quote.quote),
      mint: mintUrl,
      amount: Amount.make(amount),
      invoice: Bolt11Invoice.make(quote.request),
      expiresAt: quote.expiry ? UnixSeconds.make(quote.expiry) : null,
      locked,
    });

  it("mints an unlocked quote once and reports it issued the second time", async () => {
    const seed = randomSeed();
    const { proofs, operations, layers } = durableStorage();
    const wallet = await loadWallet();
    const quote = await wallet.createMintQuoteBolt11(24);
    const draft = draftOf(quote, 24, false);

    const adoptOnce = () =>
      runLinkshu(
        { bip39Seed: seed, ...layers },
        Effect.flatMap(Topup, (topup) => Effect.either(topup.adopt(draft))),
      );

    const first = await adoptOnce();
    assert(first._tag === "Right");
    expect(first.right.amount).toBe(24);
    expect(first.right.quoteId).toBe(quote.quote);

    const second = await adoptOnce();
    assert(second._tag === "Left");
    expect(second.left._tag).toBe("QuoteAlreadyIssued");

    expect(availableTotalOf(await Effect.runPromise(proofs.loadAll))).toBe(24);
    expect(await pendingOperations(operations, "topup")).toEqual([]);
  });

  it("mints a NUT-20 locked quote with its key and rejects it without", async () => {
    const seed = randomSeed();
    const { proofs, layers } = durableStorage();
    const { privkey, pubkey } = secp256k1Keypair();
    const wallet = await loadWallet();
    const quote = await wallet.createLockedMintQuote(40, pubkey);
    const draft = draftOf(quote, 40, true);

    const withoutKey = await runLinkshu(
      { bip39Seed: seed, ...layers },
      Effect.flatMap(Topup, (topup) => Effect.either(topup.adopt(draft))),
    );
    assert(withoutKey._tag === "Left");
    expect(withoutKey.left._tag).toBe("MintRejected");

    const withKey = await runLinkshu(
      { bip39Seed: seed, ...layers },
      Effect.flatMap(Topup, (topup) =>
        Effect.either(topup.adopt(draft, { lockingKey: privkey })),
      ),
    );
    assert(withKey._tag === "Right");
    expect(withKey.right.amount).toBe(40);

    const stored = await Effect.runPromise(proofs.loadAll);
    expect(stored.every((proof) => proof.state === "available")).toBe(true);
    expect(availableTotalOf(stored)).toBe(40);
  });
});

describe("NUT-17 mint quote subscription against the local mint", () => {
  // The push itself is covered by unit tests: the dev mint's FakeWallet only
  // settles a quote once it is polled over HTTP, so no websocket delivers a
  // settlement here. What only a real mint can prove is that its advertised
  // NUT-17 support parses into the answer the topup branches on.
  it("detects the mint's advertised websocket support for bolt11 mint quotes", async () => {
    const wallet = await loadMintWallet();

    expect(
      supportsMintQuoteSubscription(wallet, CurrencyUnit.make("sat")),
    ).toBe(true);
    expect(
      supportsMintQuoteSubscription(wallet, CurrencyUnit.make("usd")),
    ).toBe(false);
  });
});
