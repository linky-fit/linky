import { Effect } from "effect";
import {
  parseTokenText,
  Receive,
  ReceiveDraft,
  runLinkshu,
  TokenStore,
} from "../../src";
import {
  fundProofs,
  fundToken,
  inputFee,
  mintUrl,
  randomSeed,
  receiveOnce,
  tokenOf,
} from "./helpers";

describe("receive vertical against the local mint", () => {
  it("accepts a funded token into an accepted row, net of the mint's input fee", async () => {
    const proofs = await fundProofs(10);
    const token = tokenOf(proofs);
    const { receipt, rows } = await receiveOnce(randomSeed(), token);

    expect(receipt.mint).toBe(mintUrl);
    expect(receipt.unit).toBe("sat");
    expect(receipt.amount).toBe(10 - inputFee(proofs.length));

    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe("accepted");
    expect(rows[0].error).toBeNull();
    expect(rows[0].originalTokenText).toBe(token);
    expect(rows[0].tokenText).toBe(receipt.tokenText);
    expect(rows[0].tokenText).not.toBe(token);
    expect(parseTokenText(receipt.tokenText)?.amount).toBe(receipt.amount);
  });

  it("recovers a deliberately stale counter and still accepts", async () => {
    const seed = randomSeed();
    const first = await fundProofs(8);
    const second = await fundProofs(8);

    const run1 = await receiveOnce(seed, tokenOf(first));
    expect(run1.receipt.amount).toBe(8 - inputFee(first.length));

    // A fresh runtime forgets the counter (in-memory KV): the second receive
    // re-derives outputs the mint already signed and must recover via the
    // restore-window scan.
    const run2 = await receiveOnce(seed, tokenOf(second));
    expect(run2.receipt.amount).toBe(8 - inputFee(second.length));
    expect(run2.rows).toHaveLength(1);
    expect(run2.rows[0].state).toBe("accepted");
    expect(run2.receipt.tokenText).not.toBe(run1.receipt.tokenText);
  });

  it("dedupes a second receive of the same token text", async () => {
    const token = await fundToken(4);

    const { first, second, rows } = await runLinkshu(
      { bip39Seed: randomSeed() },
      Effect.gen(function* () {
        const receive = yield* Receive;
        const firstReceipt = yield* receive.receive(
          new ReceiveDraft({ text: token }),
        );
        const secondError = yield* Effect.flip(
          receive.receive(new ReceiveDraft({ text: token })),
        );
        return {
          first: firstReceipt,
          second: secondError,
          rows: yield* (yield* TokenStore).loadAll,
        };
      }),
    );

    expect(second).toMatchObject({
      _tag: "TokenAlreadyKnown",
      rowId: first.rowId,
    });
    expect(rows).toHaveLength(1);
  });

  it("persists a spent token as a typed error row", async () => {
    const token = await fundToken(4);
    await receiveOnce(randomSeed(), token);

    // A different wallet re-receiving the original text: its inputs are now
    // spent, a definitive rejection that must persist as an error row.
    const { error, rows } = await runLinkshu(
      { bip39Seed: randomSeed() },
      Effect.gen(function* () {
        const receive = yield* Receive;
        const failure = yield* Effect.flip(
          receive.receive(new ReceiveDraft({ text: token })),
        );
        return { error: failure, rows: yield* (yield* TokenStore).loadAll };
      }),
    );

    expect(error).toMatchObject({ _tag: "TokenAlreadySpent", mint: mintUrl });
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe("error");
    expect(JSON.parse(rows[0].error ?? "")).toMatchObject({
      _tag: "TokenAlreadySpent",
    });
  });
});
