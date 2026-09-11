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

describe("validation vertical against the local mint", () => {
  it("detects externally spent proofs on refresh and marks them spent", async () => {
    const funded = await fundToken(12);

    const { funding, report, proofs, balances } = await runLinkshu(
      { bip39Seed: randomSeed() },
      Effect.gen(function* () {
        const receive = yield* Receive;
        const tokens = yield* Tokens;
        const validation = yield* Validation;
        const funding = yield* receive.receive(
          new ReceiveDraft({ text: funded }),
        );

        // Nothing has happened to the proofs yet: the inventory stays as it is.
        const healthy = yield* validation.checkAll;
        expect(healthy.markedSpent).toEqual([]);
        expect(healthy.unavailableMints).toEqual([]);

        yield* Effect.promise(() => claimExternally(funding.tokenText));

        const report = yield* validation.checkAll;
        return {
          funding,
          report,
          proofs: yield* tokens.proofs,
          balances: yield* tokens.balances,
        };
      }),
    );

    expect(proofs.length).toBeGreaterThan(0);
    expect(report.checkedProofs).toBe(proofs.length);
    expect(report.markedSpent).toHaveLength(proofs.length);
    expect(
      report.markedSpent.reduce((sum, entry) => sum + entry.amount, 0),
    ).toBe(funding.amount);
    expect(report.unavailableMints).toEqual([]);

    expect(proofs.every((proof) => proof.state === "spent")).toBe(true);
    expect(balances.total).toBe(0);
  });

  it("closes an issued send once the recipient claims it", async () => {
    const funded = await fundToken(20);

    const { receipt, report, transfers, proofs } = await runLinkshu(
      { bip39Seed: randomSeed() },
      Effect.gen(function* () {
        const receive = yield* Receive;
        const send = yield* Send;
        const tokens = yield* Tokens;
        const validation = yield* Validation;
        yield* receive.receive(new ReceiveDraft({ text: funded }));
        const receipt = yield* send.send(
          new SendDraft({
            mint: mintUrl,
            amount: Amount.make(5),
            produceAs: "issued",
          }),
        );

        // Unclaimed: the send must survive the check untouched.
        const unclaimed = yield* validation.checkIssued;
        expect(unclaimed.claimed).toEqual([]);

        yield* Effect.promise(() => claimExternally(receipt.tokenText));

        const report = yield* validation.checkIssued;
        return {
          receipt,
          report,
          transfers: yield* tokens.transfers,
          proofs: yield* tokens.proofs,
        };
      }),
    );

    expect(report.claimed).toEqual([
      expect.objectContaining({
        operationId: receipt.operationId,
        amount: receipt.amount,
      }),
    ]);
    expect(
      transfers.find((transfer) => transfer.id === receipt.operationId),
    ).toMatchObject({ kind: "send", status: "done" });

    const handedOut = proofs.filter(
      (proof) => proof.operationId === receipt.operationId,
    );
    expect(handedOut.length).toBeGreaterThan(0);
    expect(handedOut.every((proof) => proof.state === "spent")).toBe(true);
    // The change is untouched by an issued-token check.
    expect(amountIn(proofs, "available")).toBe(receipt.changeAmount);
  });

  it("follows a handed-out send from live to spent through checkTransfer", async () => {
    const funded = await fundToken(20);

    const { live, spent, transfers } = await runLinkshu(
      { bip39Seed: randomSeed() },
      Effect.gen(function* () {
        const validation = yield* Validation;
        yield* (yield* Receive).receive(new ReceiveDraft({ text: funded }));
        const receipt = yield* (yield* Send).send(
          new SendDraft({
            mint: mintUrl,
            amount: Amount.make(5),
            produceAs: "pending",
          }),
        );
        const live = yield* validation.checkTransfer(receipt.operationId);
        yield* Effect.promise(() => claimExternally(receipt.tokenText));
        const spent = yield* validation.checkTransfer(receipt.operationId);
        return { live, spent, transfers: yield* (yield* Tokens).transfers };
      }),
    );

    expect(live.status).toBe("live");
    expect(spent.status).toBe("spent");
    expect(transfers.map((transfer) => transfer.status)).toEqual([
      "done",
      "done",
    ]);
  });
});
