import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { TestClock } from "effect/testing";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { makeFileKeyValueStore } from "./fileKeyValueStore";

/** A fresh path plus a factory, so a test can simulate a process restart. */
const wallet = () => {
  const filePath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "linkshu-cli-")),
    "kv.json",
  );
  return { filePath, open: () => makeFileKeyValueStore(filePath) };
};

describe("fileKeyValueStore values", () => {
  it("round-trips a value through the file", async () => {
    const { open } = wallet();
    await Effect.runPromise(open().set("linkshu.counter", "7"));
    expect(await Effect.runPromise(open().get("linkshu.counter"))).toBe("7");
  });

  it("returns null for an absent key", async () => {
    expect(
      await Effect.runPromise(wallet().open().get("linkshu.nope")),
    ).toBeNull();
  });

  it("removes a key", async () => {
    const { open } = wallet();
    await Effect.runPromise(open().set("linkshu.counter", "7"));
    await Effect.runPromise(open().remove("linkshu.counter"));
    expect(await Effect.runPromise(open().get("linkshu.counter"))).toBeNull();
  });

  it("lists keys by prefix, which is what a seed-bound wipe needs", async () => {
    const store = wallet().open();
    await Effect.runPromise(store.set("linkshu.counter.a", "1"));
    await Effect.runPromise(store.set("linkshu.counter.b", "2"));
    await Effect.runPromise(store.set("linkshu.quote.c", "3"));

    const keys = await Effect.runPromise(store.listKeys("linkshu.counter."));
    expect([...keys].sort()).toEqual([
      "linkshu.counter.a",
      "linkshu.counter.b",
    ]);
  });
});

describe("fileKeyValueStore leases", () => {
  it("hands the lease to one holder at a time", async () => {
    const store = wallet().open();
    const first = await Effect.runPromise(
      store.tryAcquireLease("counter", 5_000),
    );
    const second = await Effect.runPromise(
      store.tryAcquireLease("counter", 5_000),
    );

    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it("keeps the lease held across a process restart", async () => {
    const { open } = wallet();
    expect(
      await Effect.runPromise(open().tryAcquireLease("counter", 5_000)),
    ).not.toBeNull();
    expect(
      await Effect.runPromise(open().tryAcquireLease("counter", 5_000)),
    ).toBeNull();
  });

  it("frees the lease on release", async () => {
    const store = wallet().open();
    const lease = await Effect.runPromise(
      store.tryAcquireLease("counter", 5_000),
    );
    if (lease === null)
      throw new Error("expected the first acquisition to win");

    await Effect.runPromise(store.releaseLease("counter", lease));
    expect(
      await Effect.runPromise(store.tryAcquireLease("counter", 5_000)),
    ).not.toBeNull();
  });

  it("ignores a release from someone who no longer holds it", async () => {
    const store = wallet().open();
    const stale = await Effect.runPromise(store.tryAcquireLease("counter", 1));
    if (stale === null)
      throw new Error("expected the first acquisition to win");
    await Bun.sleep(10);

    const current = await Effect.runPromise(
      store.tryAcquireLease("counter", 5_000),
    );
    await Effect.runPromise(store.releaseLease("counter", stale));

    expect(current).not.toBeNull();
    expect(
      await Effect.runPromise(store.tryAcquireLease("counter", 5_000)),
    ).toBeNull();
  });

  it("lets an expired lease be claimed again", async () => {
    const store = wallet().open();
    expect(
      await Effect.runPromise(store.tryAcquireLease("counter", 1)),
    ).not.toBeNull();
    await Bun.sleep(10);
    expect(
      await Effect.runPromise(store.tryAcquireLease("counter", 5_000)),
    ).not.toBeNull();
  });

  it("keeps a renewed lease from another process past its first ttl", async () => {
    const { open } = wallet();
    const reacquired = await Effect.runPromise(
      Effect.gen(function* () {
        const lease = yield* open().tryAcquireLease("counter", 1_000);
        if (lease === null)
          throw new Error("expected the first acquisition to win");
        yield* TestClock.adjust("800 millis");
        yield* open().renewLease("counter", lease, 1_000);
        yield* TestClock.adjust("800 millis");
        return yield* open().tryAcquireLease("counter", 1_000);
      }).pipe(Effect.provide(TestClock.layer())),
    );

    expect(reacquired).toBeNull();
  });

  it("keeps values and leases in the same file", async () => {
    const { filePath, open } = wallet();
    await Effect.runPromise(open().set("linkshu.counter", "7"));
    await Effect.runPromise(open().tryAcquireLease("counter", 5_000));

    const written: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
    expect(written).toMatchObject({ values: { "linkshu.counter": "7" } });
  });
});
