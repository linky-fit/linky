import { KeyValueStore, LeaseId } from "@linky-fit/linkshu";
import type { KeyValueStoreService } from "@linky-fit/linkshu";
import { Clock, Effect, Layer } from "effect";
import { canLockAcrossTabs } from "../../utils/storage";

/**
 * Linkshu's `KeyValueStore` port over localStorage — device-local state that
 * is never Evolu-synced. Values and lease records live under separate
 * adapter prefixes so leasing a key cannot collide with its value and
 * `listKeys` only ever sees this store's own entries.
 *
 * A lease is a Web Lock held until `releaseLease` or the tab closing, so
 * two tabs or workers of the origin never both hold one, and it ignores the
 * TTL. Without Web Locks (insecure origins, browsers before 2022) it falls
 * back to a localStorage record that lapses after its TTL unless renewed,
 * and which two tabs can both claim: localStorage has no compare-and-swap,
 * and its writes reach other tabs late.
 */

const VALUE_KEY_PREFIX = "linky.linkshu.value.";
const LEASE_KEY_PREFIX = "linky.linkshu.lease.";

/** The part of the Web Locks API (`navigator.locks`) a lease needs. */
export interface LeaseLocks {
  readonly request: (
    name: string,
    options: { readonly ifAvailable: true },
    callback: (lock: Lock | null) => Promise<void> | undefined,
  ) => Promise<void>;
}

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
      Effect.async<LeaseId | null>((resume) => {
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
          // A refused request (a document that is not fully active) grants nothing.
          resume(Effect.succeed(null));
        });
      }),

    renewLease: () => Effect.void,

    // Resolves once the lock is free, so the next claim in this tab wins.
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

const isLeaseRecord = (value: unknown): value is LeaseRecord => {
  if (typeof value !== "object" || value === null) return false;
  return (
    typeof Reflect.get(value, "lease") === "string" &&
    typeof Reflect.get(value, "expiresAtMs") === "number"
  );
};

const readLeaseRecord = (storageKey: string): LeaseRecord | null => {
  const raw = localStorage.getItem(storageKey);
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isLeaseRecord(parsed) ? parsed : null;
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
      // Re-reading catches some, not all, tabs claiming the key at once.
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

const browserLocks = (): LeaseLocks | null =>
  canLockAcrossTabs() ? navigator.locks : null;

export const makeLocalStorageKeyValueStore = (
  locks: LeaseLocks | null = browserLocks(),
): KeyValueStoreService => ({
  get: (key) => Effect.sync(() => localStorage.getItem(VALUE_KEY_PREFIX + key)),

  set: (key, value) =>
    Effect.sync(() => {
      localStorage.setItem(VALUE_KEY_PREFIX + key, value);
    }),

  remove: (key) =>
    Effect.sync(() => {
      localStorage.removeItem(VALUE_KEY_PREFIX + key);
    }),

  listKeys: (prefix) =>
    Effect.sync(() => {
      const matchPrefix = VALUE_KEY_PREFIX + prefix;
      const keys: string[] = [];
      for (let index = 0; index < localStorage.length; index += 1) {
        const storageKey = localStorage.key(index);
        if (storageKey !== null && storageKey.startsWith(matchPrefix)) {
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
