import { NewOperation, NewProof, OperationId, ProofId } from "@linky/linkshu";
import { Effect, Schema } from "effect";
import { makeInMemoryShardDb, type ShardDb } from "../core";
import { cashuProofIdFor } from "@linky/domain";
import { linkyTableColumns, type LinkyDbSchema } from "../model/schema";
import { createLinkyStore } from "../model/store";
import { linkyStore, runNow } from "../testing/linky";
import { run, testAppOwner, tick } from "../testing/toy";
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

const toColumns = (p: NewProof) => ({
  mint: p.mint,
  unit: p.unit,
  keysetId: p.keysetId,
  amount: p.amount,
  secret: p.secret,
  c: p.C,
  state: p.state,
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
      const { db, appOwner } = linkyStore();
      tick(1_700_000_000_000);
      const delayedDb: ShardDb<LinkyDbSchema> = {
        ...db,
        mutate: (mutations) =>
          Effect.sync(() => tick(1_000)).pipe(
            Effect.flatMap(() => db.mutate(mutations)),
          ),
      };
      const store = createLinkyStore(delayedDb, appOwner);
      const { proofs } = makeWalletRepository(store);
      const [first] = run(proofs.insert([proof("s1")]));
      const [again] = run(proofs.insert([proof("s1", "spent")]));
      expect(first?.id).toBe(cashuProofIdFor("s1"));
      expect(again?.id).toBe(first?.id);
      expect(again?.createdAt).toBe(first?.createdAt);
      const all = run(proofs.loadAll);
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

    it("reads a proof as spent when an older shard's copy says so", () => {
      const { db, store } = linkyStore();
      const { proofs } = makeWalletRepository(store);
      const [stored] = runNow(proofs.insert([proof("s1")]));
      if (stored === undefined) throw new Error("no proof stored");
      runNow(proofs.update(stored.id, { state: "spent" }));
      runNow(store.rotate("cashu"));
      // Another device that had not seen the rotation wrote the same
      // proof into the new shard before learning it was spent.
      runNow(
        db.mutate([
          {
            kind: "upsert",
            table: "cashuProof",
            ownerId: store.shardOwner("cashu", 1).id,
            row: { ...toColumns(proof("s1")), id: stored.id },
          },
        ]),
      );
      expect(runNow(proofs.loadAll).map((p) => p.state)).toEqual(["spent"]);
    });

    it("reads a proof as spent when the copy a copy-forward tombstoned was spent meanwhile", () => {
      const { db, store } = linkyStore();
      const { proofs } = makeWalletRepository(store);
      const [stored] = runNow(proofs.insert([proof("s1")]));
      if (stored === undefined) throw new Error("no proof stored");
      runNow(store.rotate("cashu"));
      runNow(proofs.update(stored.id, { state: "held" }));
      // The other device spent it in shard 0 while this one held it in shard 1.
      runNow(
        db.mutate([
          {
            kind: "update",
            table: "cashuProof",
            ownerId: store.shardOwner("cashu", 0).id,
            row: { id: stored.id, state: "spent" },
          },
        ]),
      );
      expect(runNow(proofs.loadAll).map((p) => p.state)).toEqual(["spent"]);
      runNow(proofs.update(stored.id, { state: "spent" }));
      expect(
        runNow(db.readTable("cashuProof")).map((row) => row.state),
      ).toEqual(["spent", "spent"]);
    });

    it("checks rotation once per inserted batch and still rotates on time", () => {
      const db = makeInMemoryShardDb<LinkyDbSchema>(linkyTableColumns);
      let usageReads = 0;
      const counting: ShardDb<LinkyDbSchema> = {
        ...db,
        ownerUsage: (ownerId) =>
          Effect.suspend(() => {
            usageReads += 1;
            return db.ownerUsage(ownerId);
          }),
      };
      const store = createLinkyStore(counting, testAppOwner());
      const { proofs } = makeWalletRepository(store);
      const batch = Array.from({ length: 20 }, (_, i) => proof(`s${i}`));
      runNow(proofs.insert(batch));
      expect(usageReads).toBe(1);
      for (let i = 1; i < 10; i += 1)
        runNow(
          proofs.insert(
            batch.map((p) => ({ ...p, secret: `${i}-${p.secret}` })),
          ),
        );
      expect(runNow(store.activeIndex("cashu"))).toBe(1);
      expect(runNow(proofs.loadAll)).toHaveLength(200);
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
