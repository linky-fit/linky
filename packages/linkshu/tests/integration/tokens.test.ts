import { Effect } from "effect";
import {
  Amount,
  Receive,
  ReceiveDraft,
  Restore,
  RestoreDraft,
  runLinkshu,
  Send,
  SendDraft,
  Tokens,
  Validation,
} from "../../src";
import { amountIn } from "../../src/testing/inventory";
import { claimExternally, fundToken, mintUrl, randomSeed } from "./helpers";

describe("tokens vertical against the local mint", () => {
  it("bulk reclaims NFC tokens and closed sends, invalidating every old copy", async () => {
    const funded = await fundToken(128);
    const result = await runLinkshu(
      { bip39Seed: randomSeed() },
      Effect.gen(function* () {
        const tokens = yield* Tokens;
        const send = yield* Send;
        yield* (yield* Receive).receive(new ReceiveDraft({ text: funded }));
        const closed = yield* send.send(
          new SendDraft({
            mint: mintUrl,
            amount: Amount.make(16),
            produceAs: "pending",
          }),
        );
        yield* tokens.forget(closed.operationId);
        const nfc = yield* send.send(
          new SendDraft({
            mint: mintUrl,
            amount: Amount.make(16),
            produceAs: "issued",
          }),
        );
        yield* tokens.markExternalized(nfc.operationId);
        const before = yield* tokens.balances;
        const selected = (yield* tokens.proofs)
          .filter(
            (proof) =>
              proof.state === "handedOut" || proof.state === "externalized",
          )
          .map((proof) => proof.id);
        const report = yield* tokens.reclaim(selected);
        const again = yield* tokens.reclaim(selected);
        return {
          closed,
          nfc,
          before,
          report,
          again,
          proofs: yield* tokens.proofs,
          transfers: yield* tokens.transfers,
          after: yield* tokens.balances,
        };
      }),
    );
    expect(result.report.unresolvedProofs).toEqual([]);
    expect(result.report.reclaimedAmount).toBeGreaterThan(0);
    expect(result.report.reclaimedAmount).toBeLessThan(32);
    expect(result.after.total).toBe(
      result.before.total + result.report.reclaimedAmount,
    );
    expect(result.again.reclaimedAmount).toBe(0);
    expect(
      result.transfers.every(
        (transfer) =>
          transfer.kind !== "send" || transfer.status === "returned",
      ),
    ).toBe(true);
    expect(
      amountIn(result.proofs, "handedOut") +
        amountIn(result.proofs, "externalized"),
    ).toBe(0);
    await expect(claimExternally(result.closed.tokenText)).rejects.toThrow();
    await expect(claimExternally(result.nfc.tokenText)).rejects.toThrow();
  });

  it("re-signs seed-restored available proofs so lost outgoing copies cannot be claimed", async () => {
    const seed = randomSeed();
    const funded = await fundToken(64);
    const sent = await runLinkshu(
      { bip39Seed: seed },
      Effect.gen(function* () {
        yield* (yield* Receive).receive(new ReceiveDraft({ text: funded }));
        return yield* (yield* Send).send(
          new SendDraft({
            mint: mintUrl,
            amount: Amount.make(16),
            produceAs: "issued",
          }),
        );
      }),
    );
    const result = await runLinkshu(
      { bip39Seed: seed },
      Effect.gen(function* () {
        const tokens = yield* Tokens;
        const restored = yield* (yield* Restore).restore(
          new RestoreDraft({ mints: [mintUrl] }),
        );
        const report = yield* tokens.reclaim(
          (yield* tokens.proofs).map((proof) => proof.id),
        );
        return { restored, report, balance: yield* tokens.balances };
      }),
    );
    expect(result.restored.restoredAmount).toBeGreaterThan(16);
    expect(result.report.unresolvedProofs).toEqual([]);
    expect(result.report.reclaimedAmount).toBeGreaterThan(0);
    expect(result.balance.total).toBe(result.report.reclaimedAmount);
    await expect(claimExternally(sent.tokenText)).rejects.toThrow();
  });

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
