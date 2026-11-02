import {
  KeysetId,
  NewOperation,
  NewProof,
  OperationId,
  ProofId,
} from "@linky-fit/linkshu";
import { Effect, Schema } from "effect";
import { makeInMemoryShardDb, type ShardDb } from "../core";
import { cashuProofIdFor } from "@linky-fit/domain";
import { linkyTableColumns, type LinkyDbSchema } from "../model/schema";
import { createLinkyStore } from "../model/store";
import { linkyStore, runNow } from "../testing/linky";
import { run, testAppOwner, tick } from "../testing/toy";
import { makeWalletRepository } from "./wallet";

const proof = (
  secret: string,
  state: NewProof["state"] = "available",
  overrides: Partial<{
    keysetId: string;
    mint: string;
    operationId: string;
  }> = {},
) =>
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
    ...overrides,
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

const statesOf = (proofs: ReadonlyArray<{ readonly state: string }>) =>
  proofs.map((p) => p.state);

describe("wallet repository", () => {
  describe("proof store", () => {
    it("derives the id from the secret and upserts onto the same row, keeping its createdAt", () => {
      const { store } = linkyStore();
      tick(1_700_000_000_000);
      const { proofs } = makeWalletRepository(store);
      const [first] = run(proofs.write({ insert: [proof("s1")] }));
      tick(5_000);
      const [again] = run(proofs.write({ insert: [proof("s1", "spent")] }));
      expect(first?.id).toBe(cashuProofIdFor("s1"));
      expect(again?.id).toBe(first?.id);
      expect(first?.createdAt).toBe(1_700_000_000);
      expect(again?.createdAt).toBe(first?.createdAt);
      expect(statesOf(run(proofs.findBySecrets(["s1"])))).toEqual(["spent"]);
      expect(run(proofs.loadUnspent)).toEqual([]);
    });

    it("applies patches and ignores unknown ids", () => {
      const { store } = linkyStore();
      const { proofs } = makeWalletRepository(store);
      const [stored] = runNow(proofs.write({ insert: [proof("s1")] }));
      if (stored === undefined) throw new Error("no proof stored");
      runNow(
        proofs.write({ update: [{ id: stored.id, patch: { state: "held" } }] }),
      );
      runNow(
        proofs.write({
          update: [
            {
              id: ProofId.make(cashuProofIdFor("missing")),
              patch: {
                state: "spent",
              },
            },
          ],
        }),
      );
      expect(statesOf(runNow(proofs.loadUnspent))).toEqual(["held"]);
    });

    it("updates a proof born in an old shard on the active shard, not in place", () => {
      const { db, store } = linkyStore();
      const { proofs } = makeWalletRepository(store);
      const [stored] = runNow(proofs.write({ insert: [proof("s1")] }));
      if (stored === undefined) throw new Error("no proof stored");
      runNow(store.rotate("cashu"));
      runNow(
        proofs.write({
          update: [{ id: stored.id, patch: { state: "spent" } }],
        }),
      );
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
      expect(statesOf(runNow(proofs.findBySecrets(["s1"])))).toEqual(["spent"]);
      expect(runNow(proofs.loadUnspent)).toEqual([]);
    });

    it("reads a proof as spent when an older shard's copy says so", () => {
      const { db, store } = linkyStore();
      const { proofs } = makeWalletRepository(store);
      const [stored] = runNow(proofs.write({ insert: [proof("s1")] }));
      if (stored === undefined) throw new Error("no proof stored");
      runNow(
        proofs.write({
          update: [{ id: stored.id, patch: { state: "spent" } }],
        }),
      );
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
      expect(statesOf(runNow(proofs.findBySecrets(["s1"])))).toEqual(["spent"]);
      expect(runNow(proofs.loadUnspent)).toEqual([]);
    });

    it("reads a proof as spent when the copy a copy-forward tombstoned was spent meanwhile", () => {
      const { db, store } = linkyStore();
      const { proofs } = makeWalletRepository(store);
      const [stored] = runNow(proofs.write({ insert: [proof("s1")] }));
      if (stored === undefined) throw new Error("no proof stored");
      runNow(store.rotate("cashu"));
      runNow(
        proofs.write({ update: [{ id: stored.id, patch: { state: "held" } }] }),
      );
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
      expect(statesOf(runNow(proofs.findBySecrets(["s1"])))).toEqual(["spent"]);
      expect(runNow(proofs.loadUnspent)).toEqual([]);
      runNow(
        proofs.write({
          update: [{ id: stored.id, patch: { state: "spent" } }],
        }),
      );
      expect(
        runNow(db.readTable("cashuProof")).map((row) => row.state),
      ).toEqual(["spent", "spent"]);
    });

    it("loads a copied-forward proof once, in the state of its live copy", () => {
      const { store } = linkyStore();
      const { proofs } = makeWalletRepository(store);
      const [held, spent] = runNow(
        proofs.write({ insert: [proof("held"), proof("spent")] }),
      );
      if (held === undefined || spent === undefined)
        throw new Error("no proof stored");
      runNow(store.rotate("cashu"));
      runNow(
        proofs.write({ update: [{ id: held.id, patch: { state: "held" } }] }),
      );
      runNow(
        proofs.write({ update: [{ id: spent.id, patch: { state: "spent" } }] }),
      );
      expect(
        runNow(proofs.loadUnspent).map((p) => [p.secret, p.state]),
      ).toEqual([["held", "held"]]);
    });

    it("reads every proof for backups, spent ones included", () => {
      const { store } = linkyStore();
      const wallet = makeWalletRepository(store);
      const [, spent] = runNow(
        wallet.proofs.write({ insert: [proof("kept"), proof("spent")] }),
      );
      if (spent === undefined) throw new Error("no proof stored");
      runNow(store.rotate("cashu"));
      runNow(
        wallet.proofs.write({
          update: [{ id: spent.id, patch: { state: "spent" } }],
        }),
      );
      expect(
        runNow(wallet.allProofs)
          .map((p) => [p.secret, p.state])
          .sort(),
      ).toEqual([
        ["kept", "available"],
        ["spent", "spent"],
      ]);
    });

    it("finds an operation's proofs in any state and nothing else", () => {
      const { store } = linkyStore();
      const { proofs, operations } = makeWalletRepository(store);
      const send = runNow(operations.insert(operation("cashuBsend")));
      const other = runNow(operations.insert(operation("cashuBother")));
      const linked = (secret: string, state: NewProof["state"], id: string) =>
        proof(secret, state, { operationId: id });
      runNow(
        proofs.write({
          insert: [
            linked("claimed", "spent", send.id),
            linked("out", "handedOut", send.id),
            linked("elsewhere", "handedOut", other.id),
            proof("free"),
          ],
        }),
      );
      runNow(store.rotate("cashu"));
      const [out] = runNow(proofs.findBySecrets(["out"]));
      if (out === undefined) throw new Error("no proof stored");
      runNow(
        proofs.write({ update: [{ id: out.id, patch: { state: "spent" } }] }),
      );
      expect(
        runNow(proofs.findByOperation(send.id))
          .map((p) => [p.secret, p.state])
          .sort(),
      ).toEqual([
        ["claimed", "spent"],
        ["out", "spent"],
      ]);
      expect(
        runNow(proofs.findByOperation(OperationId.make("unknown"))),
      ).toEqual([]);
    });

    it("finds the oldest proof of each keyset, spent ones and old shards included", () => {
      const { db, appOwner } = linkyStore();
      tick(1_700_000_000_000);
      const ticking: ShardDb<LinkyDbSchema> = {
        ...db,
        mutate: (mutations) =>
          Effect.sync(() => tick(1_000)).pipe(
            Effect.flatMap(() => db.mutate(mutations)),
          ),
      };
      const store = createLinkyStore(ticking, appOwner);
      const { proofs } = makeWalletRepository(store);
      const [first] = run(
        proofs.write({
          insert: [proof("first", "available", { keysetId: "00aa" })],
        }),
      );
      if (first === undefined) throw new Error("no proof stored");
      run(
        proofs.write({ update: [{ id: first.id, patch: { state: "spent" } }] }),
      );
      run(store.rotate("cashu"));
      run(
        proofs.write({
          insert: [
            proof("later", "available", {
              keysetId: "00aa",
              mint: "https://other.example",
            }),
            proof("unasked", "available", { keysetId: "00cc" }),
          ],
        }),
      );
      expect(
        run(
          proofs.findOldestByKeysets(
            ["00aa", "00bb"].map((id) => KeysetId.make(id)),
          ),
        ).map((p) => [p.secret, p.mint]),
      ).toEqual([["first", "https://mint.example"]]);
    });

    it("subscribes to the unspent proofs, not to the whole proof table", () => {
      const { db, appOwner } = linkyStore();
      const narrowed: Array<[string, string, ReadonlyArray<string>]> = [];
      const whole: Array<string> = [];
      const recording: ShardDb<LinkyDbSchema> = {
        ...db,
        subscribe: (table, listener) => {
          whole.push(table);
          return db.subscribe(table, listener);
        },
        subscribeWhere: (table, column, values, listener) => {
          narrowed.push([table, column, values]);
          return db.subscribeWhere(table, column, values, listener);
        },
      };
      const { subscribe } = makeWalletRepository(
        createLinkyStore(recording, appOwner),
      );
      subscribe(() => {})();
      expect(narrowed).toEqual([
        [
          "cashuProof",
          "state",
          ["available", "held", "handedOut", "externalized"],
        ],
      ]);
      expect(whole).not.toContain("cashuProof");
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
      runNow(proofs.write({ insert: batch }));
      expect(usageReads).toBe(1);
      for (let i = 1; i < 10; i += 1)
        runNow(
          proofs.write({
            insert: batch.map((p) => ({ ...p, secret: `${i}-${p.secret}` })),
          }),
        );
      expect(runNow(store.activeIndex("cashu"))).toBe(1);
      expect(runNow(proofs.loadUnspent)).toHaveLength(200);
    });

    it("writes a settlement in one mutation, copying old proofs forward", () => {
      const { db, appOwner } = linkyStore();
      const store = createLinkyStore(db, appOwner);
      const { proofs } = makeWalletRepository(store);
      const [old, active] = runNow(
        proofs.write({ insert: [proof("old"), proof("kept")] }),
      );
      if (old === undefined || active === undefined)
        throw new Error("no proof stored");
      runNow(store.rotate("cashu"));
      const [current] = runNow(proofs.write({ insert: [proof("current")] }));
      if (current === undefined) throw new Error("no proof stored");
      let mutates = 0;
      const counting = makeWalletRepository(
        createLinkyStore(
          {
            ...db,
            mutate: (mutations) => {
              mutates += 1;
              return db.mutate(mutations);
            },
          },
          appOwner,
        ),
      );

      const stored = runNow(
        counting.proofs.write({
          insert: [proof("out", "handedOut"), proof("change")],
          update: [
            { id: old.id, patch: { state: "spent" } },
            { id: current.id, patch: { state: "spent" } },
          ],
        }),
      );

      expect(mutates).toBe(1);
      expect(stored.map((p) => p.secret)).toEqual(["out", "change"]);
      expect(
        runNow(proofs.loadUnspent)
          .map((p) => [p.secret, p.state])
          .sort(),
      ).toEqual([
        ["change", "available"],
        ["kept", "available"],
        ["out", "handedOut"],
      ]);
      const oldCopies = runNow(db.readTable("cashuProof")).filter(
        (row) => row.secret === "old",
      );
      expect(oldCopies.map((row) => [row.state, row.isDeleted])).toEqual([
        ["available", 1],
        ["spent", null],
      ]);
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
      expect(runNow(proofs.loadUnspent)).toEqual([]);
      expect(runNow(proofs.findBySecrets(["bad"]))).toEqual([]);
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
