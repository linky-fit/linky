import { KeyValueStore, LeaseId } from "@linky-fit/linkshu";
import type { KeyValueStoreService } from "@linky-fit/linkshu";
import { Clock, Effect, Layer, Schema } from "effect";
import { makeJsonFile } from "./jsonFile";

/**
 * The `KeyValueStore` port over one JSON file — values and leases together,
 * so acquiring a lease and writing under it touch the same locked file.
 */
const KeyValueFile = Schema.Struct({
  values: Schema.Record(Schema.String, Schema.String),
  leases: Schema.Record(
    Schema.String,
    Schema.Struct({ lease: LeaseId, expiresAt: Schema.Number }),
  ),
});
type KeyValueFile = typeof KeyValueFile.Type;

const EMPTY: KeyValueFile = { values: {}, leases: {} };

const without = <V>(
  record: Readonly<Record<string, V>>,
  key: string,
): Record<string, V> =>
  Object.fromEntries(
    Object.entries(record).filter(([candidate]) => candidate !== key),
  );

export const makeFileKeyValueStore = (
  filePath: string,
): KeyValueStoreService => {
  const file = makeJsonFile(filePath, KeyValueFile, EMPTY);
  return {
    get: (key) => Effect.map(file.read, (state) => state.values[key] ?? null),

    set: (key, value) =>
      file.modify((state) => [
        { ...state, values: { ...state.values, [key]: value } },
        undefined,
      ]),

    remove: (key) =>
      file.modify((state) => [
        { ...state, values: without(state.values, key) },
        undefined,
      ]),

    listKeys: (prefix) =>
      Effect.map(file.read, (state) =>
        Object.keys(state.values).filter((key) => key.startsWith(prefix)),
      ),

    tryAcquireLease: (key, ttlMs) =>
      Effect.flatMap(Clock.currentTimeMillis, (now) =>
        file.modify((state) => {
          const held = state.leases[key];
          if (held !== undefined && held.expiresAt > now) return [state, null];
          const lease = LeaseId.make(crypto.randomUUID());
          return [
            {
              ...state,
              leases: {
                ...state.leases,
                [key]: { lease, expiresAt: now + ttlMs },
              },
            },
            lease,
          ];
        }),
      ),

    releaseLease: (key, lease) =>
      file.modify((state) =>
        state.leases[key]?.lease === lease
          ? [{ ...state, leases: without(state.leases, key) }, undefined]
          : [state, undefined],
      ),
  };
};

export const fileKeyValueStore = (
  filePath: string,
): Layer.Layer<KeyValueStore> =>
  Layer.sync(KeyValueStore, () => makeFileKeyValueStore(filePath));
