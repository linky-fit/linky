import { Mint } from "@cashu/cashu-ts";
import { Effect } from "effect";
import {
  Amount,
  decodeTokenText,
  NewTokenRow,
  parseTokenText,
  Receive,
  ReceiveDraft,
  runLinkshu,
  Send,
  SendDraft,
  TokenStore,
  TokenText,
} from "../../src";
import {
  fundToken,
  inputFee,
  mintUrl,
  randomSeed,
  receiveOnce,
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
        return { funding, receipt, rows: yield* (yield* TokenStore).loadAll };
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

    // The funding row is gone; change is an accepted row, the send is issued.
    const issued = a.rows.find((row) => row.state === "issued");
    expect(issued?.id).toBe(a.receipt.rowId);
    expect(issued?.tokenText).toBe(a.receipt.tokenText);
    const accepted = a.rows.filter((row) => row.state === "accepted");
    if (a.receipt.changeAmount > 0) {
      expect(accepted).toHaveLength(1);
      expect(parseTokenText(accepted[0].tokenText)?.amount).toBe(
        a.receipt.changeAmount,
      );
    } else {
      expect(accepted).toHaveLength(0);
    }
    expect(a.rows.some((row) => row.originalTokenText === funded)).toBe(false);

    // Wallet B (separate seed and storage) receives the produced token. The
    // mint uses v2 keyset ids, so decoding the v4 token needs the keyset list.
    const keysetIds = (await new Mint(mintUrl).getKeySets()).keysets.map(
      (keyset) => keyset.id,
    );
    const sendProofCount = decodeTokenText(a.receipt.tokenText, keysetIds)
      ?.proofs.length;
    expect(sendProofCount).toBeGreaterThan(0);
    const b = await receiveOnce(randomSeed(), a.receipt.tokenText);
    expect(b.receipt.amount).toBe(5 - inputFee(sendProofCount ?? 0));
    expect(b.rows).toHaveLength(1);
    expect(b.rows[0].state).toBe("accepted");
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

  it("excludes NUT-07 spent rows before sending and marks them error", async () => {
    // A token another wallet already claimed: its proofs are spent at the mint.
    const spentToken = await fundToken(4);
    await receiveOnce(randomSeed(), spentToken);

    const funded = await fundToken(10);
    const { funding, receipt, rows } = await runLinkshu(
      { bip39Seed: randomSeed() },
      Effect.gen(function* () {
        const receive = yield* Receive;
        const send = yield* Send;
        const tokenStore = yield* TokenStore;
        const funding = yield* receive.receive(
          new ReceiveDraft({ text: funded }),
        );
        // A stale accepted row pointing at the spent proofs (e.g. state
        // synced from a device that missed the spend).
        yield* tokenStore.insert(
          new NewTokenRow({
            originalTokenText: TokenText.make(spentToken),
            tokenText: TokenText.make(spentToken),
            state: "accepted",
            error: null,
          }),
        );
        const receipt = yield* send.send(
          new SendDraft({
            mint: mintUrl,
            amount: Amount.make(3),
            produceAs: "pending",
          }),
        );
        return { funding, receipt, rows: yield* tokenStore.loadAll };
      }),
    );

    // The send succeeded from the live row alone.
    expect(receipt.amount).toBe(3);
    expect(funding.amount).toBe(3 + receipt.changeAmount + receipt.feePaid);

    const staleRow = rows.find((row) => row.tokenText === spentToken);
    expect(staleRow?.state).toBe("error");
    expect(JSON.parse(staleRow?.error ?? "")).toMatchObject({
      _tag: "TokenAlreadySpent",
      mint: mintUrl,
    });
    expect(rows.find((row) => row.id === receipt.rowId)?.state).toBe("pending");
  });
});
