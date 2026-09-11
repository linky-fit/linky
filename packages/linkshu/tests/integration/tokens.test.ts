import { Effect } from "effect";
import {
  Amount,
  Receive,
  ReceiveDraft,
  runLinkshu,
  Send,
  SendDraft,
  Tokens,
  Validation,
} from "../../src";
import { amountIn } from "../../src/testing/inventory";
import { claimExternally, fundToken, mintUrl, randomSeed } from "./helpers";

describe("tokens vertical against the local mint", () => {
  it("returns an issued token to the wallet, killing the issued encoding", async () => {
    const funded = await fundToken(64);

    const { sent, returned, transfers, proofs, balances } = await runLinkshu(
      { bip39Seed: randomSeed() },
      Effect.gen(function* () {
        const tokens = yield* Tokens;
        yield* (yield* Receive).receive(new ReceiveDraft({ text: funded }));
        const sent = yield* (yield* Send).send(
          new SendDraft({
            mint: mintUrl,
            amount: Amount.make(8),
            produceAs: "issued",
          }),
        );

        const returned = yield* tokens.returnToWallet(sent.operationId);
        return {
          sent,
          returned,
          transfers: yield* tokens.transfers,
          proofs: yield* tokens.proofs,
          balances: yield* tokens.balances,
        };
      }),
    );

    // The same transfer, closed as returned; the mint's input fee is the
    // difference between what was handed out and what came back.
    expect(returned.operationId).toBe(sent.operationId);
    expect(returned.amount).toBeGreaterThan(0);
    expect(returned.amount).toBeLessThanOrEqual(sent.amount);
    expect(
      transfers.find((transfer) => transfer.id === sent.operationId),
    ).toMatchObject({ kind: "send", status: "returned" });

    // The handed-out proofs are dead and stay on record; the fresh ones and
    // the send's change are the balance.
    const handedOut = proofs.filter(
      (proof) => proof.operationId === sent.operationId,
    );
    expect(handedOut.length).toBeGreaterThan(0);
    expect(handedOut.every((proof) => proof.state === "spent")).toBe(true);
    expect(amountIn(proofs, "handedOut")).toBe(0);
    expect(balances.total).toBe(sent.changeAmount + returned.amount);

    // The encoding that was handed out is dead at the mint.
    await expect(claimExternally(sent.tokenText)).rejects.toThrow();
  });

  it("checkAll marks an externally spent proof spent and the balance drops", async () => {
    const claimed = await fundToken(12);
    const kept = await fundToken(20);

    const { spent, live, before, report, proofs, after } = await runLinkshu(
      { bip39Seed: randomSeed() },
      Effect.gen(function* () {
        const receive = yield* Receive;
        const tokens = yield* Tokens;
        const validation = yield* Validation;
        const spent = yield* receive.receive(
          new ReceiveDraft({ text: claimed }),
        );
        const live = yield* receive.receive(new ReceiveDraft({ text: kept }));
        const before = yield* tokens.balances;

        // Nothing is spent yet: a check must not touch either.
        expect((yield* validation.checkAll).markedSpent).toEqual([]);

        yield* Effect.promise(() => claimExternally(spent.tokenText));

        const report = yield* validation.checkAll;
        return {
          spent,
          live,
          before,
          report,
          proofs: yield* tokens.proofs,
          after: yield* tokens.balances,
        };
      }),
    );

    expect(before.total).toBe(spent.amount + live.amount);
    expect(
      report.markedSpent.reduce((sum, entry) => sum + entry.amount, 0),
    ).toBe(spent.amount);
    expect(report.unavailableMints).toEqual([]);

    // Spent proofs are kept on record, never deleted; only the balance moves.
    expect(amountIn(proofs, "spent")).toBe(spent.amount);
    expect(amountIn(proofs, "available")).toBe(live.amount);
    expect(after.total).toBe(live.amount);
  });
});
