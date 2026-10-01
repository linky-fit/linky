import { Clock, Effect, Layer } from "effect";
import { KeyValueStore, LeaseId } from "./KeyValueStore";
import type { KeyValueStoreService } from "./KeyValueStore";

/**
 * One non-durable store instance. Exported so callers can keep the storage
 * alive across separate runtimes — the layer builds a fresh instance each
 * time, which is exactly what a crash-recovery test must not do.
 */
export const makeInMemoryKeyValueStore = (): KeyValueStoreService => {
  const values = new Map<string, string>();
  const leases = new Map<string, { lease: LeaseId; expiresAt: number }>();
  return {
    get: (key) => Effect.sync(() => values.get(key) ?? null),
    set: (key, value) =>
      Effect.sync(() => {
        values.set(key, value);
      }),
    remove: (key) =>
      Effect.sync(() => {
        values.delete(key);
      }),
    listKeys: (prefix) =>
      Effect.sync(() =>
        [...values.keys()].filter((key) => key.startsWith(prefix)),
      ),
    tryAcquireLease: (key, ttlMs) =>
      Effect.map(Clock.currentTimeMillis, (now) => {
        const existing = leases.get(key);
        if (existing !== undefined && existing.expiresAt > now) return null;
        const lease = LeaseId.make(crypto.randomUUID());
        leases.set(key, { lease, expiresAt: now + ttlMs });
        return lease;
      }),
    renewLease: (key, lease, ttlMs) =>
      Effect.map(Clock.currentTimeMillis, (now) => {
        if (leases.get(key)?.lease === lease) {
          leases.set(key, { lease, expiresAt: now + ttlMs });
        }
      }),
    releaseLease: (key, lease) =>
      Effect.sync(() => {
        if (leases.get(key)?.lease === lease) leases.delete(key);
      }),
  };
};

/** Non-durable, single-process; for tests and quick experiments. */
export const inMemoryKeyValueStore: Layer.Layer<KeyValueStore> = Layer.sync(
  KeyValueStore,
  makeInMemoryKeyValueStore,
);
