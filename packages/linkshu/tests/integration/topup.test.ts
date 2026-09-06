import { Mint, Wallet } from "@cashu/cashu-ts";
import type { MintQuoteBolt11Response } from "@cashu/cashu-ts";
import { Effect } from "effect";
import { createECDH } from "node:crypto";
import {
  Amount,
  Bolt11Invoice,
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
import { PENDING_TOPUP_KEY_PREFIX } from "../../src/topup/internal/pendingTopup";
import { durableStorage, mintUrl, randomSeed } from "./helpers";

describe("topup vertical against the local mint", () => {
  it("drives quote, poll, and mint into one accepted row", async () => {
    const { kv, tokens, layers } = durableStorage();

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

    const rows = await Effect.runPromise(tokens.loadAll);
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe("accepted");
    expect(rows[0].id).toBe(receipt.rowId);

    // A finished topup leaves no pending work behind.
    expect(
      await Effect.runPromise(kv.listKeys(PENDING_TOPUP_KEY_PREFIX)),
    ).toEqual([]);
  });

  it("resumes a topup interrupted after quote creation and spends the result", async () => {
    const seed = randomSeed();
    const { kv, tokens, layers } = durableStorage();

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
    expect(await Effect.runPromise(tokens.loadAll)).toEqual([]);
    expect(
      await Effect.runPromise(kv.listKeys(PENDING_TOPUP_KEY_PREFIX)),
    ).toHaveLength(1);

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

    // The record is gone and the funds are rows, not a dangling quote.
    expect(
      await Effect.runPromise(kv.listKeys(PENDING_TOPUP_KEY_PREFIX)),
    ).toEqual([]);
    const accepted = (await Effect.runPromise(tokens.loadAll)).filter(
      (row) => row.state === "accepted",
    );
    expect(accepted.length).toBeGreaterThan(0);
  });

  it("resumes the same quote rather than minting it twice", async () => {
    const seed = randomSeed();
    const { kv, tokens, layers } = durableStorage();

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

    // The record is cleared, so a second resume has nothing left to claim and
    // the 16 sats stay a single row.
    expect(await resumeOnce()).toBeNull();
    expect(
      await Effect.runPromise(kv.listKeys(PENDING_TOPUP_KEY_PREFIX)),
    ).toEqual([]);
    expect(await Effect.runPromise(tokens.loadAll)).toHaveLength(1);
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
    const { kv, tokens, layers } = durableStorage();
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

    expect(await Effect.runPromise(tokens.loadAll)).toHaveLength(1);
    expect(
      await Effect.runPromise(kv.listKeys(PENDING_TOPUP_KEY_PREFIX)),
    ).toEqual([]);
  });

  it("mints a NUT-20 locked quote with its key and rejects it without", async () => {
    const seed = randomSeed();
    const { tokens, layers } = durableStorage();
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

    const rows = await Effect.runPromise(tokens.loadAll);
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe("accepted");
  });
});
