import { KeyValueStore, LeaseId } from "@linky-fit/linkshu";
import type { KeyValueStoreService } from "@linky-fit/linkshu";
import { Clock, Effect, Layer } from "effect";

/**
 * Linkshu's `KeyValueStore` port over localStorage — device-local state that
 * is never Evolu-synced. Values and lease records live under separate
 * adapter prefixes so leasing a key cannot collide with its value and
 * `listKeys` only ever sees this store's own entries.
 */

const VALUE_KEY_PREFIX = "linky.linkshu.value.";
const LEASE_KEY_PREFIX = "linky.linkshu.lease.";

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

export const makeLocalStorageKeyValueStore = (): KeyValueStoreService => ({
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

  tryAcquireLease: (key, ttlMs) =>
    Effect.map(Clock.currentTimeMillis, (now) => {
      const storageKey = LEASE_KEY_PREFIX + key;
      const held = readLeaseRecord(storageKey);
      if (held !== null && held.expiresAtMs > now) return null;
      const lease = LeaseId.make(crypto.randomUUID());
      localStorage.setItem(
        storageKey,
        JSON.stringify({ expiresAtMs: now + ttlMs, lease }),
      );
      // localStorage has no compare-and-swap; re-reading detects another tab
      // winning the same acquisition between the read and the write.
      return readLeaseRecord(storageKey)?.lease === lease ? lease : null;
    }),

  releaseLease: (key, lease) =>
    Effect.sync(() => {
      const storageKey = LEASE_KEY_PREFIX + key;
      if (readLeaseRecord(storageKey)?.lease === lease) {
        localStorage.removeItem(storageKey);
      }
    }),
});

export const localStorageKeyValueStore: Layer.Layer<KeyValueStore> = Layer.sync(
  KeyValueStore,
  makeLocalStorageKeyValueStore,
);
