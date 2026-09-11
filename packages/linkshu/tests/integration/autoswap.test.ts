import { getDecodedToken } from "@cashu/cashu-ts";
import { Effect } from "effect";
import {
  Amount,
  Autoswap,
  AutoswapDraft,
  Bolt11Invoice,
  CurrencyUnit,
  KeysetId,
  NewOperation,
  QuoteId,
  Receive,
  ReceiveDraft,
  runLinkshu,
  UnixSeconds,
} from "../../src";
import {
  availableTotalOf,
  durableStorage,
  fundToken,
  loadMintWallet,
  mintUrl,
  pendingOperations,
  randomSeed,
  targetMintUrl,
  toCashuProofs,
  tokenOf,
} from "./helpers";

describe("autoswap between local mints", () => {
  it("moves the source balance into spendable proofs at another mint", async () => {
    expect(targetMintUrl).not.toBe(mintUrl);
    const { proofs, operations, layers } = durableStorage();
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

    const stored = await Effect.runPromise(proofs.loadAll);
    const target = stored.filter((proof) => proof.mint === targetMintUrl);
    expect(target.length).toBeGreaterThan(0);
    expect(target.every((proof) => proof.state === "available")).toBe(true);
    expect(availableTotalOf(target)).toBe(receipt.movedAmount);

    const source = stored.filter((proof) => proof.mint === mintUrl);
    expect(availableTotalOf(source)).toBeLessThan(16);
    // Nothing is held: the melt closed and its inputs are spent on record.
    expect(
      stored.every(
        (proof) => proof.state === "available" || proof.state === "spent",
      ),
    ).toBe(true);

    const available = availableTotalOf(stored);
    expect(available).toBeGreaterThanOrEqual(receipt.movedAmount);
    expect(funding.amount - available).toBeGreaterThanOrEqual(receipt.feePaid);
    expect(funding.amount - available).toBeLessThanOrEqual(16);
    expect(await pendingOperations(operations, "autoswap")).toEqual([]);
    expect(
      (await Effect.runPromise(operations.loadAll)).find(
        (operation) => operation.id === receipt.operationId,
      ),
    ).toMatchObject({
      kind: "autoswap",
      status: "done",
      mint: targetMintUrl,
      sourceMint: mintUrl,
    });

    const sourceWallet = await loadMintWallet();
    const sourceStates = await sourceWallet.checkProofsStates(
      getDecodedToken(funding.tokenText, [sourceWallet.keysetId]).proofs,
    );
    expect(sourceStates.every((proof) => proof.state === "SPENT")).toBe(true);

    const receiver = await loadMintWallet(targetMintUrl);
    expect(receiver.keysetId).not.toBe(sourceWallet.keysetId);
    const targetProofs = toCashuProofs(target);
    const before = await receiver.checkProofsStates(targetProofs);
    expect(before.every((proof) => proof.state === "UNSPENT")).toBe(true);
    const received = await receiver.receive(
      tokenOf(targetProofs, targetMintUrl),
      undefined,
      { type: "random" },
    );
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
    const { proofs, operations, layers } = durableStorage();

    // The state an interrupted claim leaves: the invoice is settled at the
    // mint (the FakeWallet backend pays its own quotes) and the pending
    // autoswap names the quote to mint against, but no run ever minted it.
    const wallet = await loadMintWallet(targetMintUrl);
    const quote = await wallet.createMintQuoteBolt11(64);
    const pending = await Effect.runPromise(
      operations.insert(
        new NewOperation({
          kind: "autoswap",
          status: "pending",
          mint: targetMintUrl,
          unit: CurrencyUnit.make("sat"),
          keysetId: KeysetId.make(wallet.keysetId),
          amount: Amount.make(64),
          feeReserve: null,
          inputsTotal: null,
          quoteId: QuoteId.make(quote.quote),
          invoice: Bolt11Invoice.make(quote.request),
          sourceMint: mintUrl,
          counter: null,
          locked: null,
          expiresAt: null,
          createdAt: UnixSeconds.make(Math.floor(Date.now() / 1000)),
          tokenText: null,
          error: null,
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
    expect(first[0]).toMatchObject({
      status: "claimed",
      amount: 64,
      targetMint: targetMintUrl,
      operationId: pending.id,
    });
    expect(await pendingOperations(operations, "autoswap")).toEqual([]);

    // The autoswap is closed, so a second pass has nothing left to claim and
    // the 64 sats are minted exactly once.
    expect(await resumeOnce()).toEqual([]);
    const stored = await Effect.runPromise(proofs.loadAll);
    expect(stored.every((proof) => proof.mint === targetMintUrl)).toBe(true);
    expect(availableTotalOf(stored)).toBe(64);
  });
});
