import { Effect } from "effect";
import {
  Amount,
  Receive,
  ReceiveDraft,
  runLinkshu,
  Send,
  SendDraft,
  TokenStore,
  Validation,
} from "../../src";
import { claimExternally, fundToken, mintUrl, randomSeed } from "./helpers";

describe("validation vertical against the local mint", () => {
  it("detects an externally spent row on refresh and marks it error", async () => {
    const funded = await fundToken(12);

    const { funding, report, rows } = await runLinkshu(
      { bip39Seed: randomSeed() },
      Effect.gen(function* () {
        const receive = yield* Receive;
        const validation = yield* Validation;
        const funding = yield* receive.receive(
          new ReceiveDraft({ text: funded }),
        );

        // Nothing has happened to the proofs yet: the row stays as it is.
        const healthy = yield* validation.checkAll;
        expect(healthy.markedSpent).toEqual([]);
        expect(healthy.unavailableMints).toEqual([]);

        yield* Effect.promise(() => claimExternally(funding.tokenText));

        const report = yield* validation.checkAll;
        return { funding, report, rows: yield* (yield* TokenStore).loadAll };
      }),
    );

    expect(report.checkedRows).toBe(1);
    expect(report.markedSpent).toHaveLength(1);
    expect(report.markedSpent[0]?.amount).toBe(funding.amount);
    expect(report.unavailableMints).toEqual([]);

    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe("error");
    expect(JSON.parse(rows[0].error ?? "")).toMatchObject({
      _tag: "TokenAlreadySpent",
      mint: mintUrl,
    });
  });

  it("prunes an issued token once the recipient claims it", async () => {
    const funded = await fundToken(20);

    const { receipt, report, rows } = await runLinkshu(
      { bip39Seed: randomSeed() },
      Effect.gen(function* () {
        const receive = yield* Receive;
        const send = yield* Send;
        const validation = yield* Validation;
        yield* receive.receive(new ReceiveDraft({ text: funded }));
        const receipt = yield* send.send(
          new SendDraft({
            mint: mintUrl,
            amount: Amount.make(5),
            produceAs: "issued",
          }),
        );

        // Unclaimed: the issued row must survive the check untouched.
        const unclaimed = yield* validation.checkIssued;
        expect(unclaimed.claimed).toEqual([]);

        yield* Effect.promise(() => claimExternally(receipt.tokenText));

        const report = yield* validation.checkIssued;
        return { receipt, report, rows: yield* (yield* TokenStore).loadAll };
      }),
    );

    expect(report.claimed).toHaveLength(1);
    expect(report.claimed[0]?.rowId).toBe(receipt.rowId);
    expect(report.claimed[0]?.amount).toBe(receipt.amount);
    expect(rows.some((row) => row.id === receipt.rowId)).toBe(false);
    // The change row is untouched by an issued-token check.
    expect(rows.every((row) => row.state === "accepted")).toBe(true);
  });

  it("consolidates several accepted rows into one without a swap", async () => {
    const first = await fundToken(6);
    const second = await fundToken(9);

    const { report, rows } = await runLinkshu(
      { bip39Seed: randomSeed() },
      Effect.gen(function* () {
        const receive = yield* Receive;
        const one = yield* receive.receive(new ReceiveDraft({ text: first }));
        const two = yield* receive.receive(new ReceiveDraft({ text: second }));
        const report = yield* (yield* Validation).checkAll;
        return {
          total: one.amount + two.amount,
          report,
          rows: yield* (yield* TokenStore).loadAll,
        };
      }),
    );

    expect(report.checkedRows).toBe(2);
    expect(report.markedSpent).toEqual([]);
    expect(report.mergedRows).toHaveLength(1);
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe("accepted");
  });
});
