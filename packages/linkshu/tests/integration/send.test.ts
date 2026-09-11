import { Effect } from "effect";
import {
  Amount,
  parseTokenText,
  ProofStore,
  Receive,
  ReceiveDraft,
  runLinkshu,
  Send,
  SendDraft,
  Tokens,
} from "../../src";
import { amountIn, secretsOf } from "../../src/testing/inventory";
import {
  availableRowsOf,
  availableTotalOf,
  fundProofs,
  fundToken,
  inputFee,
  mintUrl,
  randomSeed,
  receiveOnce,
  tokenOf,
} from "./helpers";

describe("send vertical against the local mint", () => {
  it("sends an amount as a token another wallet can receive, keeping change", async () => {
    const funded = await fundToken(20);

    // Wallet A funds itself and sends 5 in one runtime (in-memory stores).
    const a = await runLinkshu(
      { bip39Seed: randomSeed() },
      Effect.gen(function* () {
        const receive = yield* Receive;
        const send = yield* Send;
        const tokens = yield* Tokens;
        const funding = yield* receive.receive(
          new ReceiveDraft({ text: funded }),
        );
        const receipt = yield* send.send(
          new SendDraft({
            mint: mintUrl,
            amount: Amount.make(5),
            produceAs: "issued",
          }),
        );
        return {
          funding,
          receipt,
          transfers: yield* tokens.transfers,
          proofs: yield* tokens.proofs,
        };
      }),
    );

    expect(a.receipt.mint).toBe(mintUrl);
    expect(a.receipt.unit).toBe("sat");
    expect(a.receipt.amount).toBe(5);
    // Nothing leaks: funding = sent + kept change + swap fee.
    expect(a.funding.amount).toBe(
      5 + a.receipt.changeAmount + a.receipt.feePaid,
    );
    expect(parseTokenText(a.receipt.tokenText)?.amount).toBe(5);

    // The send is a transfer in the drafted status carrying the token; its
    // proofs are handed out under it, the change is available, and the
    // consumed inputs stay on record as spent.
    expect(
      a.transfers.find((transfer) => transfer.id === a.receipt.operationId),
    ).toMatchObject({
      kind: "send",
      status: "issued",
      tokenText: a.receipt.tokenText,
      amount: 5,
    });
    const handedOut = a.proofs.filter(
      (proof) => proof.operationId === a.receipt.operationId,
    );
    expect(handedOut.every((proof) => proof.state === "handedOut")).toBe(true);
    expect(secretsOf(handedOut)).toEqual(secretsOf(a.receipt.proofs));
    expect(amountIn(a.proofs, "handedOut")).toBe(5);
    expect(amountIn(a.proofs, "available")).toBe(a.receipt.changeAmount);
    expect(amountIn(a.proofs, "held")).toBe(0);

    // Wallet B (separate seed and storage) receives the produced token.
    const b = await receiveOnce(randomSeed(), a.receipt.tokenText);
    expect(b.receipt.amount).toBe(5 - inputFee(a.receipt.proofs.length));
    expect(b.proofs.every((proof) => proof.state === "available")).toBe(true);
    expect(availableTotalOf(b.proofs)).toBe(b.receipt.amount);
  });

  it("fails with typed InsufficientFunds both before and at the mint", async () => {
    const funded = await fundToken(8);

    const { funding, beyondBalance, exactBalance } = await runLinkshu(
      { bip39Seed: randomSeed() },
      Effect.gen(function* () {
        const receive = yield* Receive;
        const send = yield* Send;
        const funding = yield* receive.receive(
          new ReceiveDraft({ text: funded }),
        );
        const draftFor = (amount: number) =>
          new SendDraft({
            mint: mintUrl,
            amount: Amount.make(amount),
            produceAs: "issued",
          });
        // More than the balance: rejected locally before any mint call.
        const beyondBalance = yield* Effect.flip(
          send.send(draftFor(funding.amount + 1)),
        );
        // Exactly the balance: the swap fee cannot be covered, so the mint
        // library reports the shortfall.
        const exactBalance = yield* Effect.flip(
          send.send(draftFor(funding.amount)),
        );
        return { funding, beyondBalance, exactBalance };
      }),
    );

    expect(beyondBalance).toMatchObject({
      _tag: "InsufficientFunds",
      mint: mintUrl,
      required: funding.amount + 1,
      available: funding.amount,
    });
    expect(exactBalance).toMatchObject({
      _tag: "InsufficientFunds",
      mint: mintUrl,
      available: funding.amount,
    });
  });

  it("excludes NUT-07 spent proofs before sending and marks them spent", async () => {
    // Proofs another wallet already claimed: spent at the mint.
    const stale = await fundProofs(4);
    await receiveOnce(randomSeed(), tokenOf(stale));

    const funded = await fundToken(10);
    const { funding, receipt, transfers, proofs } = await runLinkshu(
      { bip39Seed: randomSeed() },
      Effect.gen(function* () {
        const receive = yield* Receive;
        const send = yield* Send;
        const tokens = yield* Tokens;
        const funding = yield* receive.receive(
          new ReceiveDraft({ text: funded }),
        );
        // Stale available proofs pointing at the spent secrets (e.g. state
        // synced from a device that missed the spend).
        yield* (yield* ProofStore).insert(availableRowsOf(stale));
        const receipt = yield* send.send(
          new SendDraft({
            mint: mintUrl,
            amount: Amount.make(3),
            produceAs: "pending",
          }),
        );
        return {
          funding,
          receipt,
          transfers: yield* tokens.transfers,
          proofs: yield* tokens.proofs,
        };
      }),
    );

    // The send succeeded from the live proofs alone.
    expect(receipt.amount).toBe(3);
    expect(funding.amount).toBe(3 + receipt.changeAmount + receipt.feePaid);

    const staleSecrets = new Set(stale.map((proof) => proof.secret));
    const staleRows = proofs.filter((proof) => staleSecrets.has(proof.secret));
    expect(staleRows).toHaveLength(stale.length);
    expect(staleRows.every((proof) => proof.state === "spent")).toBe(true);
    expect(
      transfers.find((transfer) => transfer.id === receipt.operationId)?.status,
    ).toBe("pending");
  });
});
