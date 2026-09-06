import {
  Bip39Seed,
  KeyValueStore,
  LeaseId,
  StoredTokenRow,
  TokenRowId,
  TokenStore,
  UnixSeconds,
} from "@linky/linkshu";
import { Effect, Layer, Schema } from "effect";

const SeedJson = Schema.parseJson(
  Schema.Array(Schema.Int.pipe(Schema.between(0, 255))).pipe(
    Schema.itemsCount(64),
  ),
);
const RowsJson = Schema.parseJson(Schema.Array(StoredTokenRow));
const LeaseJson = Schema.parseJson(
  Schema.Struct({ lease: LeaseId, expiresAtMs: Schema.Number }),
);

export const walletStorage = (prefix: string) => {
  const seedKey = `${prefix}.seed`;
  const storedSeed = localStorage.getItem(seedKey);
  const seed =
    storedSeed === null
      ? Array.from(crypto.getRandomValues(new Uint8Array(64)))
      : Schema.decodeUnknownSync(SeedJson)(storedSeed);
  if (storedSeed === null)
    localStorage.setItem(seedKey, Schema.encodeSync(SeedJson)(seed));
  const rowsKey = `${prefix}.tokens`;
  const loadRows = () =>
    Schema.decodeUnknownSync(RowsJson)(localStorage.getItem(rowsKey) ?? "[]");
  const saveRows = (rows: readonly StoredTokenRow[]) =>
    localStorage.setItem(rowsKey, Schema.encodeSync(RowsJson)(rows));
  const readLease = (key: string) => {
    const raw = localStorage.getItem(`${prefix}.lease.${key}`);
    return raw === null ? null : Schema.decodeUnknownSync(LeaseJson)(raw);
  };
  return {
    bip39Seed: Bip39Seed.make(Uint8Array.from(seed)),
    tokenStore: Layer.succeed(TokenStore, {
      loadAll: Effect.sync(loadRows),
      insert: (row) =>
        Effect.sync(() => {
          const stored = new StoredTokenRow({
            ...row,
            id: TokenRowId.make(crypto.randomUUID()),
            createdAt: UnixSeconds.make(Math.floor(Date.now() / 1000)),
          });
          saveRows([...loadRows(), stored]);
          return stored;
        }),
      update: (id, patch) =>
        Effect.sync(() =>
          saveRows(
            loadRows().map((row) =>
              row.id === id ? new StoredTokenRow({ ...row, ...patch }) : row,
            ),
          ),
        ),
      remove: (id) =>
        Effect.sync(() => saveRows(loadRows().filter((row) => row.id !== id))),
    }),
    keyValueStore: Layer.succeed(KeyValueStore, {
      get: (key) =>
        Effect.sync(() => localStorage.getItem(`${prefix}.value.${key}`)),
      set: (key, value) =>
        Effect.sync(() =>
          localStorage.setItem(`${prefix}.value.${key}`, value),
        ),
      remove: (key) =>
        Effect.sync(() => localStorage.removeItem(`${prefix}.value.${key}`)),
      listKeys: (startsWith) =>
        Effect.sync(() =>
          Object.keys(localStorage)
            .filter((key) => key.startsWith(`${prefix}.value.${startsWith}`))
            .map((key) => key.slice(`${prefix}.value.`.length)),
        ),
      tryAcquireLease: (key, ttlMs) =>
        Effect.sync(() => {
          if ((readLease(key)?.expiresAtMs ?? 0) > Date.now()) return null;
          const lease = LeaseId.make(crypto.randomUUID());
          localStorage.setItem(
            `${prefix}.lease.${key}`,
            Schema.encodeSync(LeaseJson)({
              lease,
              expiresAtMs: Date.now() + ttlMs,
            }),
          );
          return readLease(key)?.lease === lease ? lease : null;
        }),
      releaseLease: (key, lease) =>
        Effect.sync(() => {
          if (readLease(key)?.lease === lease)
            localStorage.removeItem(`${prefix}.lease.${key}`);
        }),
    }),
  };
};
