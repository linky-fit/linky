import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeLocalStorageKeyValueStore } from "./localStorageKeyValueStore";
import type { LeaseLocks } from "./localStorageKeyValueStore";

const run = Effect.runPromise;

/** Web Locks shared by every store built on them, like the tabs of one origin. */
const fakeWebLocks = (): LeaseLocks => {
  const held = new Set<string>();
  return {
    request: async (name, _options, callback) => {
      // Browsers grant asynchronously, so racing requests interleave here.
      await Promise.resolve();
      if (held.has(name)) return callback(null);
      held.add(name);
      try {
        await callback({ name, mode: "exclusive" });
      } finally {
        held.delete(name);
      }
    },
  };
};

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("makeLocalStorageKeyValueStore", () => {
  it("round-trips values through set, get, and remove", async () => {
    const store = makeLocalStorageKeyValueStore(null);

    expect(await run(store.get("linkshu.counter"))).toBeNull();

    await run(store.set("linkshu.counter", "7"));
    expect(await run(store.get("linkshu.counter"))).toBe("7");

    await run(store.set("linkshu.counter", "8"));
    expect(await run(store.get("linkshu.counter"))).toBe("8");

    await run(store.remove("linkshu.counter"));
    expect(await run(store.get("linkshu.counter"))).toBeNull();
  });

  it("lists only this store's keys matching the prefix", async () => {
    const store = makeLocalStorageKeyValueStore(null);
    await run(store.set("linkshu.counter.a", "1"));
    await run(store.set("linkshu.counter.b", "2"));
    await run(store.set("linkshu.cursor.a", "3"));
    localStorage.setItem("linky.lang", "en");

    expect([...(await run(store.listKeys("linkshu.counter.")))].sort()).toEqual(
      ["linkshu.counter.a", "linkshu.counter.b"],
    );
    expect([...(await run(store.listKeys("linkshu.")))].sort()).toEqual([
      "linkshu.counter.a",
      "linkshu.counter.b",
      "linkshu.cursor.a",
    ]);
    expect(await run(store.listKeys(""))).toHaveLength(3);
  });
});

describe.each([
  ["Web Locks", fakeWebLocks],
  ["the localStorage fallback", () => null],
])("leases over %s", (_name, makeLocks) => {
  it("keeps leases invisible to get and listKeys", async () => {
    const store = makeLocalStorageKeyValueStore(makeLocks());
    const lease = await run(store.tryAcquireLease("linkshu.lock", 60_000));

    expect(lease).not.toBeNull();
    expect(await run(store.get("linkshu.lock"))).toBeNull();
    expect(await run(store.listKeys(""))).toHaveLength(0);
  });

  it("keeps a renewed lease from another tab past its first ttl", async () => {
    vi.useFakeTimers();
    const locks = makeLocks();
    const [holder, other] = [
      makeLocalStorageKeyValueStore(locks),
      makeLocalStorageKeyValueStore(locks),
    ];

    const lease = await run(holder.tryAcquireLease("linkshu.lock", 1_000));
    if (lease === null) throw new Error("lease not acquired");
    await vi.advanceTimersByTimeAsync(800);
    await run(holder.renewLease("linkshu.lock", lease, 1_000));
    await vi.advanceTimersByTimeAsync(800);

    expect(await run(other.tryAcquireLease("linkshu.lock", 1_000))).toBeNull();
  });

  it("releases only when the caller holds the live lease", async () => {
    const store = makeLocalStorageKeyValueStore(makeLocks());
    const other = await run(store.tryAcquireLease("linkshu.other", 60_000));
    const held = await run(store.tryAcquireLease("linkshu.lock", 60_000));
    if (other === null || held === null) throw new Error("lease not acquired");

    await run(store.releaseLease("linkshu.lock", other));
    expect(await run(store.tryAcquireLease("linkshu.lock", 60_000))).toBeNull();

    await run(store.releaseLease("linkshu.lock", held));
    expect(
      await run(store.tryAcquireLease("linkshu.lock", 60_000)),
    ).not.toBeNull();
  });

  it("leases and values on the same key do not collide", async () => {
    const store = makeLocalStorageKeyValueStore(makeLocks());
    await run(store.set("linkshu.lock", "value"));
    const lease = await run(store.tryAcquireLease("linkshu.lock", 60_000));

    expect(lease).not.toBeNull();
    expect(await run(store.get("linkshu.lock"))).toBe("value");

    await run(store.remove("linkshu.lock"));
    expect(await run(store.tryAcquireLease("linkshu.lock", 60_000))).toBeNull();
  });
});

describe("leases over the localStorage fallback", () => {
  it("frees a lease nobody renews once its ttl passes", async () => {
    vi.useFakeTimers();
    const store = makeLocalStorageKeyValueStore(null);

    const first = await run(store.tryAcquireLease("linkshu.lock", 1_000));
    expect(first).not.toBeNull();
    expect(await run(store.tryAcquireLease("linkshu.lock", 1_000))).toBeNull();

    await vi.advanceTimersByTimeAsync(1_001);
    const second = await run(store.tryAcquireLease("linkshu.lock", 1_000));
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
  });
});

describe("leases over Web Locks", () => {
  it("holds a lease past its ttl until the holder releases it", async () => {
    vi.useFakeTimers();
    const locks = fakeWebLocks();
    const [holder, other] = [
      makeLocalStorageKeyValueStore(locks),
      makeLocalStorageKeyValueStore(locks),
    ];

    const lease = await run(holder.tryAcquireLease("linkshu.lock", 1_000));
    if (lease === null) throw new Error("lease not acquired");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await run(other.tryAcquireLease("linkshu.lock", 1_000))).toBeNull();

    await run(holder.releaseLease("linkshu.lock", lease));
    expect(
      await run(other.tryAcquireLease("linkshu.lock", 1_000)),
    ).not.toBeNull();
  });

  it("reports the key as held when the browser refuses the request", async () => {
    const store = makeLocalStorageKeyValueStore({
      request: () =>
        Promise.reject(
          new DOMException("not fully active", "InvalidStateError"),
        ),
    });

    expect(await run(store.tryAcquireLease("linkshu.lock", 60_000))).toBeNull();
  });
});

describe("leases across tabs", () => {
  it("lets exactly one of two tabs racing for a key hold it", async () => {
    const locks = fakeWebLocks();
    const tabs = [
      makeLocalStorageKeyValueStore(locks),
      makeLocalStorageKeyValueStore(locks),
    ];

    for (let round = 0; round < 20; round += 1) {
      const key = `linkshu.lock.${round}`;
      const leases = await Promise.all(
        tabs.map((tab) => run(tab.tryAcquireLease(key, 60_000))),
      );
      expect(leases.filter((lease) => lease !== null)).toHaveLength(1);
    }
  });

  it("frees the key for the other tab only when the holder releases it", async () => {
    const locks = fakeWebLocks();
    const [first, second] = [
      makeLocalStorageKeyValueStore(locks),
      makeLocalStorageKeyValueStore(locks),
    ];

    const lease = await run(first.tryAcquireLease("linkshu.lock", 60_000));
    if (lease === null) throw new Error("lease not acquired");
    await run(second.releaseLease("linkshu.lock", lease));
    expect(
      await run(second.tryAcquireLease("linkshu.lock", 60_000)),
    ).toBeNull();

    await run(first.releaseLease("linkshu.lock", lease));
    expect(
      await run(second.tryAcquireLease("linkshu.lock", 60_000)),
    ).not.toBeNull();
  });
});
