import { describe, expect, it } from "vitest";
import { makeSingleContextLocks } from "./singleContextLocks";

const deferred = () => {
  let resolve = () => {};
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
};

describe("makeSingleContextLocks", () => {
  it("runs requests for one name one at a time, in request order", async () => {
    const locks = makeSingleContextLocks();
    const order: string[] = [];
    const first = deferred();
    const a = locks.request("flush", async () => {
      order.push("a start");
      await first.promise;
      order.push("a end");
    });
    const b = locks.request("flush", () => order.push("b"));
    await Promise.resolve();
    expect(order).toEqual(["a start"]);
    first.resolve();
    await Promise.all([a, b]);
    expect(order).toEqual(["a start", "a end", "b"]);
  });

  it("returns the callback's result and frees the lock after it throws", async () => {
    const locks = makeSingleContextLocks();
    await expect(
      locks.request("flush", () => Promise.reject(new Error("boom"))),
    ).rejects.toThrow("boom");
    await expect(locks.request("flush", () => 42)).resolves.toBe(42);
  });

  it("hands ifAvailable a null lock while the name is taken", async () => {
    const locks = makeSingleContextLocks();
    const holding = deferred();
    const held = locks.request("flush", () => holding.promise);
    await expect(
      locks.request("flush", { ifAvailable: true }, (lock) => lock),
    ).resolves.toBeNull();
    await expect(
      locks.request("other", { ifAvailable: true }, (lock) => lock?.name),
    ).resolves.toBe("other");
    holding.resolve();
    await held;
    await expect(
      locks.request("flush", { ifAvailable: true }, (lock) => lock?.name),
    ).resolves.toBe("flush");
  });

  it("reports held and waiting requests", async () => {
    const locks = makeSingleContextLocks();
    const holding = deferred();
    const held = locks.request("flush", () => holding.promise);
    const waiting = locks.request("flush", () => undefined);
    await Promise.resolve();
    await expect(locks.query()).resolves.toEqual({
      held: [{ name: "flush", mode: "exclusive" }],
      pending: [{ name: "flush", mode: "exclusive" }],
    });
    holding.resolve();
    await Promise.all([held, waiting]);
    await expect(locks.query()).resolves.toEqual({ held: [], pending: [] });
  });
});
