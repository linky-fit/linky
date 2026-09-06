import { Effect } from "effect";
import {
  Receive,
  ReceiveDraft,
  runLinkshu,
  Tokens,
  TokenStore,
} from "../../src";
import { claimExternally, fundToken, randomSeed } from "./helpers";

describe("tokens vertical against the local mint", () => {
  it("returns an issued token to the wallet, killing the issued encoding", async () => {
    const funded = await fundToken(64);

    const { issued, returned, listed, rows, balances } = await runLinkshu(
      { bip39Seed: randomSeed() },
      Effect.gen(function* () {
        const tokens = yield* Tokens;
        const issued = yield* (yield* Receive).receive(
          new ReceiveDraft({ text: funded }),
        );
        yield* tokens.markIssued(issued.rowId);

        const returned = yield* tokens.returnToWallet(issued.rowId);
        return {
          issued,
          returned,
          listed: yield* tokens.list,
          rows: yield* (yield* TokenStore).loadAll,
          balances: yield* tokens.balances,
        };
      }),
    );

    // Fresh proofs on a fresh row; the mint's input fee is the difference.
    expect(returned.rowId).not.toBe(issued.rowId);
    expect(returned.amount).toBeLessThanOrEqual(issued.amount);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: returned.rowId, state: "accepted" });
    expect(balances.total).toBe(returned.amount);
    expect(
      listed.map((token) => [token.id, token.state, token.amount]),
    ).toEqual([[returned.rowId, "accepted", returned.amount]]);

    // The encoding that was handed out is dead at the mint.
    await expect(claimExternally(issued.tokenText)).rejects.toThrow();
  });

  it("deletes a row the mint reports spent and keeps the live one", async () => {
    const claimed = await fundToken(12);
    const kept = await fundToken(20);

    const { deleted, spentRowId, keptRowId, rows } = await runLinkshu(
      { bip39Seed: randomSeed() },
      Effect.gen(function* () {
        const receive = yield* Receive;
        const tokens = yield* Tokens;
        const spent = yield* receive.receive(
          new ReceiveDraft({ text: claimed }),
        );
        const live = yield* receive.receive(new ReceiveDraft({ text: kept }));

        // Nothing is spent yet: a sweep must not touch either row.
        expect(yield* tokens.deleteSpent).toEqual([]);

        yield* Effect.promise(() => claimExternally(spent.tokenText));

        return {
          deleted: yield* tokens.deleteSpent,
          spentRowId: spent.rowId,
          keptRowId: live.rowId,
          rows: yield* (yield* TokenStore).loadAll,
        };
      }),
    );

    expect(deleted.map((token) => token.rowId)).toEqual([spentRowId]);
    expect(rows.map((row) => row.id)).toEqual([keptRowId]);
    expect(rows[0].state).toBe("accepted");
  });
});
