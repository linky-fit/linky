import {
  Amount,
  CurrencyUnit,
  KeysetId,
  MintUrl,
  NewOperation,
  NewProof,
  QuoteId,
  UnixSeconds,
} from "@linky-fit/linkshu";
import { describe, expect, it } from "bun:test";
import { Effect, TestClock, TestContext } from "effect";
import { join } from "node:path";
import {
  makeSqliteKeyValueStore,
  makeSqliteOperationStore,
  makeSqliteProofStore,
} from "./linkshuStores";
import { SupporterStorage } from "./storage";
import { withTempDir } from "./testSupport";

const run = <A>(effect: Effect.Effect<A>): Promise<A> =>
  Effect.runPromise(effect);

const proof = (secret: string) =>
  new NewProof({
    mint: MintUrl.make("https://mint.example"),
    unit: CurrencyUnit.make("sat"),
    keysetId: KeysetId.make("009a1f293253e41e"),
    amount: Amount.make(4),
    secret,
    C: "02" + "ab".repeat(32),
    dleq: null,
    state: "available",
    operationId: null,
  });

const melt = (quoteId: string) =>
  new NewOperation({
    kind: "melt",
    status: "pending",
    mint: MintUrl.make("https://mint.example"),
    unit: CurrencyUnit.make("sat"),
    keysetId: null,
    amount: Amount.make(21),
    feeReserve: null,
    inputsTotal: null,
    quoteId: QuoteId.make(quoteId),
    invoice: null,
    sourceMint: null,
    counter: null,
    locked: null,
    expiresAt: null,
    createdAt: UnixSeconds.make(1_700_000_000),
    tokenText: null,
    error: null,
  });

describe("sqlite KeyValueStore", () => {
  it("gets, sets, removes and lists only this store's keys by prefix", async () => {
    const storage = new SupporterStorage(":memory:");
    const kv = makeSqliteKeyValueStore(storage.db);
    storage.linkstrStorage.setItem("linkshu.not-mine", "x");
    await run(kv.set("linkshu.counter.a", "1"));
    await run(kv.set("linkshu.counter.b", "2"));
    await run(kv.set("linkshu.quote.c", "3"));
    await run(kv.remove("linkshu.counter.b"));
    expect(await run(kv.get("linkshu.counter.a"))).toBe("1");
    expect(await run(kv.get("linkshu.counter.b"))).toBeNull();
    expect(await run(kv.listKeys("linkshu.counter."))).toEqual([
      "linkshu.counter.a",
    ]);
    expect(await run(kv.listKeys("linkshu.%"))).toEqual([]);
  });

  it("gives a lease to one connection of the file at a time", async () => {
    await withTempDir(async (directory) => {
      const path = join(directory, "supporter.sqlite");
      const service = new SupporterStorage(path);
      const cli = new SupporterStorage(path);
      const first = makeSqliteKeyValueStore(service.db);
      const second = makeSqliteKeyValueStore(cli.db);
      const lease = await run(first.tryAcquireLease("counter", 5_000));
      expect(lease).not.toBeNull();
      expect(await run(second.tryAcquireLease("counter", 5_000))).toBeNull();
      if (lease === null) throw new Error("expected a lease");
      await run(first.releaseLease("counter", lease));
      expect(
        await run(second.tryAcquireLease("counter", 5_000)),
      ).not.toBeNull();
      service.close();
      cli.close();
    });
  });

  it("keeps a renewed lease past its first ttl, and only for its holder", async () => {
    const kv = makeSqliteKeyValueStore(new SupporterStorage(":memory:").db);
    await run(
      Effect.gen(function* () {
        const lease = yield* kv.tryAcquireLease("k", 1_000);
        const foreign = yield* kv.tryAcquireLease("other", 1_000);
        if (lease === null || foreign === null)
          throw new Error("expected a lease");
        yield* TestClock.adjust("800 millis");
        yield* kv.renewLease("k", foreign, 60_000);
        yield* kv.renewLease("k", lease, 1_000);
        yield* TestClock.adjust("800 millis");
        expect(yield* kv.tryAcquireLease("k", 1_000)).toBeNull();
        yield* TestClock.adjust("201 millis");
        expect(yield* kv.tryAcquireLease("k", 1_000)).not.toBeNull();
      }).pipe(Effect.provide(TestContext.TestContext)),
    );
  });
});

describe("sqlite ProofStore", () => {
  it("upserts by secret, keeps createdAt and survives a reopen", async () => {
    await withTempDir(async (directory) => {
      const path = join(directory, "supporter.sqlite");
      const store = makeSqliteProofStore(new SupporterStorage(path).db);
      const [stored] = await run(store.insert([proof("aa"), proof("bb")]));
      const [again] = await run(store.insert([proof("aa")]));
      expect(again?.id).toBe(stored?.id);
      expect(again?.createdAt).toBe(stored?.createdAt);
      if (stored === undefined) throw new Error("nothing stored");
      await run(store.update(stored.id, { state: "spent" }));

      const reopened = makeSqliteProofStore(new SupporterStorage(path).db);
      const rows = await run(reopened.loadAll);
      expect(rows.map((row) => [row.secret, row.state])).toEqual([
        ["aa", "spent"],
        ["bb", "available"],
      ]);
    });
  });

  it("skips a row that does not decode instead of repairing it", async () => {
    const storage = new SupporterStorage(":memory:");
    const store = makeSqliteProofStore(storage.db);
    await run(store.insert([proof("aa")]));
    storage.db
      .query("INSERT INTO linkshu_proofs (id, row) VALUES (?, ?)")
      .run("broken", "{}");
    expect((await run(store.loadAll)).map((row) => row.secret)).toEqual(["aa"]);
  });
});

describe("sqlite OperationStore", () => {
  it("derives the id from the operation key and patches in place", async () => {
    const store = makeSqliteOperationStore(new SupporterStorage(":memory:").db);
    const first = await run(store.insert(melt("q1")));
    const second = await run(store.insert(melt("q1")));
    await run(store.insert(melt("q2")));
    expect(second.id).toBe(first.id);
    await run(store.update(first.id, { status: "paid", counter: 7 }));
    const rows = await run(store.loadAll);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ status: "paid", counter: 7 });
  });
});
