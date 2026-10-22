import { KeyValueStore, LeaseId } from "@linky-fit/linkshu";
import type { KeyValueStoreService } from "@linky-fit/linkshu";
import { Clock, Effect, Layer } from "effect";

/**
 * linkshu's `KeyValueStore` port over localStorage: device-local wallet
 * state (counters, caches) that never syncs. A lease is a Web Lock held
 * until it is released or the tab closes, so two tabs never both hold one;
 * without Web Locks it falls back to a localStorage record that lapses after
 * its TTL unless renewed.
 */

const VALUE_KEY_PREFIX = "linky.linkshu.value.";
const LEASE_KEY_PREFIX = "linky.linkshu.lease.";

/** The part of the Web Locks API (`navigator.locks`) a lease needs. */
interface LeaseLocks {
  readonly request: (
    name: string,
    options: { readonly ifAvailable: true },
    callback: (lock: Lock | null) => Promise<void> | undefined,
  ) => Promise<void>;
}

const browserLocks = (): LeaseLocks | null =>
  globalThis.isSecureContext && "locks" in navigator ? navigator.locks : null;

type Leases = Pick<
  KeyValueStoreService,
  "tryAcquireLease" | "renewLease" | "releaseLease"
>;

const webLockLeases = (locks: LeaseLocks): Leases => {
  const held = new Map<
    LeaseId,
    { key: string; release: () => void; released: Promise<void> }
  >();
  return {
    tryAcquireLease: (key) =>
      Effect.callback<LeaseId | null>((resume) => {
        const lease = LeaseId.make(crypto.randomUUID());
        const request = locks.request(
          LEASE_KEY_PREFIX + key,
          { ifAvailable: true },
          (lock) => {
            if (lock === null) {
              resume(Effect.succeed(null));
              return undefined;
            }
            // The lock is held until this promise settles.
            return new Promise<void>((release) => {
              held.set(lease, { key, release, released: request });
              resume(Effect.succeed(lease));
            });
          },
        );
        const forget = () => held.delete(lease);
        request.then(forget, () => {
          forget();
          resume(Effect.succeed(null));
        });
      }),
    renewLease: () => Effect.void,
    releaseLease: (key, lease) =>
      Effect.suspend(() => {
        const entry = held.get(lease);
        if (entry?.key !== key) return Effect.void;
        entry.release();
        return Effect.promise(() => entry.released);
      }),
  };
};

interface LeaseRecord {
  readonly expiresAtMs: number;
  readonly lease: string;
}

const readLeaseRecord = (storageKey: string): LeaseRecord | null => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "");
    if (typeof parsed !== "object" || parsed === null) return null;
    const lease: unknown = Reflect.get(parsed, "lease");
    const expiresAtMs: unknown = Reflect.get(parsed, "expiresAtMs");
    return typeof lease === "string" && typeof expiresAtMs === "number"
      ? { lease, expiresAtMs }
      : null;
  } catch {
    return null;
  }
};

const writeLeaseRecord = (storageKey: string, record: LeaseRecord): void => {
  localStorage.setItem(storageKey, JSON.stringify(record));
};

const localStorageLeases: Leases = {
  tryAcquireLease: (key, ttlMs) =>
    Effect.map(Clock.currentTimeMillis, (now) => {
      const storageKey = LEASE_KEY_PREFIX + key;
      const held = readLeaseRecord(storageKey);
      if (held !== null && held.expiresAtMs > now) return null;
      const lease = LeaseId.make(crypto.randomUUID());
      writeLeaseRecord(storageKey, { expiresAtMs: now + ttlMs, lease });
      return readLeaseRecord(storageKey)?.lease === lease ? lease : null;
    }),
  renewLease: (key, lease, ttlMs) =>
    Effect.map(Clock.currentTimeMillis, (now) => {
      const storageKey = LEASE_KEY_PREFIX + key;
      if (readLeaseRecord(storageKey)?.lease === lease) {
        writeLeaseRecord(storageKey, { expiresAtMs: now + ttlMs, lease });
      }
    }),
  releaseLease: (key, lease) =>
    Effect.sync(() => {
      const storageKey = LEASE_KEY_PREFIX + key;
      if (readLeaseRecord(storageKey)?.lease === lease) {
        localStorage.removeItem(storageKey);
      }
    }),
};

const makeLocalStorageKeyValueStore = (
  locks: LeaseLocks | null = browserLocks(),
): KeyValueStoreService => ({
  get: (key) => Effect.sync(() => localStorage.getItem(VALUE_KEY_PREFIX + key)),
  set: (key, value) =>
    Effect.sync(() => localStorage.setItem(VALUE_KEY_PREFIX + key, value)),
  remove: (key) =>
    Effect.sync(() => localStorage.removeItem(VALUE_KEY_PREFIX + key)),
  listKeys: (prefix) =>
    Effect.sync(() => {
      const matchPrefix = VALUE_KEY_PREFIX + prefix;
      const keys: string[] = [];
      for (let index = 0; index < localStorage.length; index += 1) {
        const storageKey = localStorage.key(index);
        if (storageKey?.startsWith(matchPrefix)) {
          keys.push(storageKey.slice(VALUE_KEY_PREFIX.length));
        }
      }
      return keys;
    }),
  ...(locks === null ? localStorageLeases : webLockLeases(locks)),
});

export const localStorageKeyValueStore: Layer.Layer<KeyValueStore> = Layer.sync(
  KeyValueStore,
  () => makeLocalStorageKeyValueStore(),
);
