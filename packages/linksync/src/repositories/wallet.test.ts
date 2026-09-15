import { NewOperation, NewProof, OperationId, ProofId } from "@linky/linkshu";
import { Schema } from "effect";
import { cashuProofIdFor } from "../model/ids";
import { linkyStore, runNow } from "../testing/linky";
import { makeWalletRepository } from "./wallet";

const proof = (secret: string, state: NewProof["state"] = "available") =>
  Schema.decodeUnknownSync(NewProof)({
    mint: "https://mint.example",
    unit: "sat",
    keysetId: "00ab",
    amount: 8,
    secret,
    C: "02ab",
    dleq: null,
    state,
    operationId: null,
  });

const operation = (tokenText: string) =>
  Schema.decodeUnknownSync(NewOperation)({
    kind: "send",
    status: "issued",
    mint: "https://mint.example",
    unit: "sat",
    keysetId: null,
    amount: 8,
    feeReserve: null,
    inputsTotal: null,
    quoteId: null,
    invoice: null,
    sourceMint: null,
    counter: null,
    locked: null,
    expiresAt: null,
    createdAt: 1_700_000_000,
    tokenText,
    error: null,
  });

describe("wallet repository", () => {
  describe("proof store", () => {
    it("derives the id from the secret and upserts onto the same row", () => {
      const { store } = linkyStore();
      const { proofs } = makeWalletRepository(store);
      const [first] = runNow(proofs.insert([proof("s1")]));
      const [again] = runNow(proofs.insert([proof("s1", "spent")]));
      expect(first?.id).toBe(cashuProofIdFor("s1"));
      expect(again?.id).toBe(first?.id);
      expect(again?.createdAt).toBe(first?.createdAt);
      const all = runNow(proofs.loadAll);
      expect(all).toHaveLength(1);
      expect(all[0]?.state).toBe("spent");
    });

    it("applies patches and ignores unknown ids", () => {
      const { store } = linkyStore();
      const { proofs } = makeWalletRepository(store);
      const [stored] = runNow(proofs.insert([proof("s1")]));
      if (stored === undefined) throw new Error("no proof stored");
      runNow(proofs.update(stored.id, { state: "held" }));
      runNow(
        proofs.update(ProofId.make(cashuProofIdFor("missing")), {
          state: "spent",
        }),
      );
      expect(runNow(proofs.loadAll).map((p) => p.state)).toEqual(["held"]);
    });

    it("updates a proof born in an old shard on the active shard, not in place", () => {
      const { db, store } = linkyStore();
      const { proofs } = makeWalletRepository(store);
      const [stored] = runNow(proofs.insert([proof("s1")]));
      if (stored === undefined) throw new Error("no proof stored");
      runNow(store.rotate("cashu"));
      runNow(proofs.update(stored.id, { state: "spent" }));
      const rows = runNow(db.readTable("cashuProof"));
      const old = rows.find(
        (r) => r.ownerId === store.shardOwner("cashu", 0).id,
      );
      const copy = rows.find(
        (r) => r.ownerId === store.shardOwner("cashu", 1).id,
      );
      expect(old).toMatchObject({ state: "available", isDeleted: 1 });
      expect(copy).toMatchObject({
        state: "spent",
        secret: "s1",
        isDeleted: null,
      });
      expect(runNow(proofs.loadAll).map((p) => p.state)).toEqual(["spent"]);
    });

    it("skips rows that do not validate", () => {
      const { db, store } = linkyStore();
      const { proofs } = makeWalletRepository(store);
      const broken = {
        id: cashuProofIdFor("bad"),
        mint: "not a url",
        unit: "sat",
        keysetId: "00ab",
        amount: 8,
        secret: "bad",
        c: "02ab",
        state: "available",
      };
      runNow(
        db.mutate([
          {
            kind: "upsert",
            table: "cashuProof",
            ownerId: store.shardOwner("cashu", 0).id,
            row: broken,
          },
        ]),
      );
      expect(runNow(proofs.loadAll)).toEqual([]);
    });
  });

  describe("operation store", () => {
    it("derives the id from the operation key and replaces on re-insert", () => {
      const { store } = linkyStore();
      const { operations } = makeWalletRepository(store);
      const first = runNow(operations.insert(operation("cashuBtoken")));
      const again = runNow(
        operations.insert(
          Schema.decodeUnknownSync(NewOperation)({
            ...operation("cashuBtoken"),
            status: "done",
          }),
        ),
      );
      expect(again.id).toBe(first.id);
      expect(runNow(operations.loadAll)).toMatchObject([{ status: "done" }]);
    });

    it("patches status, counter, and error; unknown id is a no-op", () => {
      const { store } = linkyStore();
      const { operations } = makeWalletRepository(store);
      const stored = runNow(operations.insert(operation("cashuBtoken")));
      runNow(
        operations.update(stored.id, {
          status: "done",
          counter: 3,
          error: "x",
        }),
      );
      runNow(operations.update(stored.id, { error: null }));
      expect(runNow(operations.loadAll)).toMatchObject([
        { status: "done", counter: 3, error: null },
      ]);
      runNow(
        operations.update(OperationId.make("unknown"), { status: "failed" }),
      );
      expect(runNow(operations.loadAll)).toMatchObject([{ status: "done" }]);
    });
  });
});
