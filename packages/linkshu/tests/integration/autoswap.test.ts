import { getDecodedToken } from "@cashu/cashu-ts";
import { Effect } from "effect";
import {
  Amount,
  Autoswap,
  AutoswapDraft,
  Bolt11Invoice,
  CurrencyUnit,
  KeysetId,
  QuoteId,
  parseTokenText,
  Receive,
  ReceiveDraft,
  runLinkshu,
  UnixSeconds,
} from "../../src";
import type { KeyValueStoreService } from "../../src";
import {
  PENDING_AUTOSWAP_CLAIM_KEY_PREFIX,
  PendingAutoswapClaim,
  pendingClaims,
} from "../../src/autoswap/internal/pendingClaim";
import {
  acceptedTotalOf,
  durableStorage,
  fundToken,
  loadMintWallet,
  mintUrl,
  randomSeed,
  targetMintUrl,
} from "./helpers";

const pendingKeys = (kv: KeyValueStoreService) =>
  Effect.runPromise(kv.listKeys(PENDING_AUTOSWAP_CLAIM_KEY_PREFIX));

describe("autoswap between local mints", () => {
  it("moves the source balance into spendable proofs at another mint", async () => {
    expect(targetMintUrl).not.toBe(mintUrl);
    const { kv, tokens, layers } = durableStorage();
    const funded = await fundToken(256);

    const { receipt, funding } = await runLinkshu(
      { bip39Seed: randomSeed(), ...layers },
      Effect.gen(function* () {
        const funding = yield* (yield* Receive).receive(
          new ReceiveDraft({ text: funded }),
        );
        const receipt = yield* (yield* Autoswap).claim(
          new AutoswapDraft({ sourceMint: mintUrl, targetMint: targetMintUrl }),
        );
        return { receipt, funding };
      }),
    );

    expect(receipt.sourceMint).toBe(mintUrl);
    expect(receipt.targetMint).toBe(targetMintUrl);
    expect(receipt.movedAmount).toBeGreaterThan(0);

    const rows = await Effect.runPromise(tokens.loadAll);
    const claimed = rows.find((row) => row.id === receipt.rowId);
    expect(claimed?.state).toBe("accepted");
    if (!claimed) throw new Error("Missing target mint row");
    expect(parseTokenText(claimed.tokenText)).toMatchObject({
      mint: targetMintUrl,
      amount: receipt.movedAmount,
    });

    const sourceRows = rows.filter(
      (row) => parseTokenText(row.tokenText)?.mint === mintUrl,
    );
    expect(acceptedTotalOf(sourceRows)).toBeLessThan(16);
    expect(rows.every((row) => row.state === "accepted")).toBe(true);

    const accepted = acceptedTotalOf(rows);
    expect(accepted).toBeGreaterThanOrEqual(receipt.movedAmount);
    expect(funding.amount - accepted).toBeGreaterThanOrEqual(receipt.feePaid);
    expect(funding.amount - accepted).toBeLessThanOrEqual(16);
    expect(await pendingKeys(kv)).toEqual([]);

    const source = await loadMintWallet();
    const sourceStates = await source.checkProofsStates(
      getDecodedToken(funding.tokenText, [source.keysetId]).proofs,
    );
    expect(sourceStates.every((proof) => proof.state === "SPENT")).toBe(true);

    const receiver = await loadMintWallet(targetMintUrl);
    expect(receiver.keysetId).not.toBe(source.keysetId);
    const targetProofs = getDecodedToken(claimed.tokenText, [
      receiver.keysetId,
    ]).proofs;
    const before = await receiver.checkProofsStates(targetProofs);
    expect(before.every((proof) => proof.state === "UNSPENT")).toBe(true);
    const received = await receiver.receive(claimed.tokenText, undefined, {
      type: "random",
    });
    const receivedAmount = received.reduce(
      (sum, proof) => sum + proof.amount.toNumber(),
      0,
    );
    expect(receivedAmount).toBeGreaterThan(0);
    expect(receivedAmount).toBeLessThanOrEqual(receipt.movedAmount);
    expect(receipt.movedAmount - receivedAmount).toBeLessThanOrEqual(2);
    const after = await receiver.checkProofsStates(targetProofs);
    expect(after.every((proof) => proof.state === "SPENT")).toBe(true);
  });

  it("claims a pending record left behind by an interrupted run, exactly once", async () => {
    const seed = randomSeed();
    const { kv, tokens, layers } = durableStorage();

    // The state an interrupted claim leaves: the invoice is settled at the
    // mint (the FakeWallet backend pays its own quotes) and the record names
    // the quote to mint against, but no run ever minted it.
    const wallet = await loadMintWallet(targetMintUrl);
    const quote = await wallet.createMintQuoteBolt11(64);
    await Effect.runPromise(
      pendingClaims.write(
        kv,
        new PendingAutoswapClaim({
          quoteId: QuoteId.make(quote.quote),
          mint: targetMintUrl,
          unit: CurrencyUnit.make("sat"),
          keysetId: KeysetId.make(wallet.keysetId),
          amount: Amount.make(64),
          invoice: Bolt11Invoice.make(quote.request),
          sourceMint: mintUrl,
          createdAt: UnixSeconds.make(Math.floor(Date.now() / 1000)),
          mintCounter: null,
        }),
      ),
    );

    const resumeOnce = () =>
      runLinkshu(
        { bip39Seed: seed, ...layers },
        Effect.flatMap(Autoswap, (autoswap) => autoswap.resumePendingClaims),
      );

    const first = await resumeOnce();
    expect(first).toHaveLength(1);
    expect(first[0].status).toBe("claimed");
    expect(first[0].amount).toBe(64);
    expect(first[0].targetMint).toBe(targetMintUrl);
    expect(await pendingKeys(kv)).toEqual([]);

    // The record is cleared, so a second pass has nothing left to claim and
    // the 64 sats stay a single row.
    expect(await resumeOnce()).toEqual([]);
    const rows = await Effect.runPromise(tokens.loadAll);
    expect(rows).toHaveLength(1);
    expect(acceptedTotalOf(rows)).toBe(64);
    expect(parseTokenText(rows[0].tokenText)?.mint).toBe(targetMintUrl);
  });
});
