import { Effect } from "effect";
import {
  parseTokenText,
  Receive,
  ReceiveDraft,
  runLinkshu,
  Tokens,
} from "../../src";
import {
  availableTotalOf,
  fundProofs,
  fundToken,
  inputFee,
  mintUrl,
  randomSeed,
  receiveOnce,
  tokenOf,
} from "./helpers";

describe("receive vertical against the local mint", () => {
  it("accepts a funded token as available proofs, net of the mint's input fee", async () => {
    const funded = await fundProofs(10);
    const token = tokenOf(funded);
    const { receipt, proofs } = await receiveOnce(randomSeed(), token);

    expect(receipt.mint).toBe(mintUrl);
    expect(receipt.unit).toBe("sat");
    expect(receipt.amount).toBe(10 - inputFee(funded.length));

    // Fresh proofs signed at the mint, owned by no operation.
    expect(proofs.length).toBeGreaterThan(0);
    expect(
      proofs.every(
        (proof) =>
          proof.state === "available" &&
          proof.operationId === null &&
          proof.mint === mintUrl,
      ),
    ).toBe(true);
    expect(availableTotalOf(proofs)).toBe(receipt.amount);
    expect(receipt.tokenText).not.toBe(token);
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
    expect(run2.proofs.every((proof) => proof.state === "available")).toBe(
      true,
    );
    expect(availableTotalOf(run2.proofs)).toBe(run2.receipt.amount);
    expect(run2.receipt.tokenText).not.toBe(run1.receipt.tokenText);
  });

  it("dedupes a second receive of the same token text", async () => {
    const token = await fundToken(4);

    const { first, second, transfers, proofs } = await runLinkshu(
      { bip39Seed: randomSeed() },
      Effect.gen(function* () {
        const receive = yield* Receive;
        const tokens = yield* Tokens;
        const firstReceipt = yield* receive.receive(
          new ReceiveDraft({ text: token }),
        );
        const secondError = yield* Effect.flip(
          receive.receive(new ReceiveDraft({ text: token })),
        );
        return {
          first: firstReceipt,
          second: secondError,
          transfers: yield* tokens.transfers,
          proofs: yield* tokens.proofs,
        };
      }),
    );

    expect(second).toMatchObject({
      _tag: "TokenAlreadyKnown",
      operationId: first.operationId,
    });
    // One receive transfer, closed, remembering the original text.
    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toMatchObject({
      id: first.operationId,
      kind: "receive",
      status: "done",
      tokenText: token,
      error: null,
    });
    expect(availableTotalOf(proofs)).toBe(first.amount);
  });

  it("persists a spent token as a failed receive transfer", async () => {
    const token = await fundToken(4);
    await receiveOnce(randomSeed(), token);

    // A different wallet re-receiving the original text: its inputs are now
    // spent, a definitive rejection that must persist on the transfer.
    const { error, transfers, proofs } = await runLinkshu(
      { bip39Seed: randomSeed() },
      Effect.gen(function* () {
        const receive = yield* Receive;
        const tokens = yield* Tokens;
        const failure = yield* Effect.flip(
          receive.receive(new ReceiveDraft({ text: token })),
        );
        return {
          error: failure,
          transfers: yield* tokens.transfers,
          proofs: yield* tokens.proofs,
        };
      }),
    );

    expect(error).toMatchObject({ _tag: "TokenAlreadySpent", mint: mintUrl });
    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toMatchObject({
      kind: "receive",
      status: "failed",
      tokenText: token,
    });
    expect(JSON.parse(transfers[0]?.error ?? "")).toMatchObject({
      _tag: "TokenAlreadySpent",
    });
    expect(proofs).toEqual([]);
  });
});
