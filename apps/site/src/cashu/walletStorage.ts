import {
  applyOperationPatch,
  applyProofPatch,
  Bip39Seed,
  deriveStoreId,
  KeyValueStore,
  LeaseId,
  OperationId,
  operationKeyOf,
  OperationStore,
  ProofId,
  ProofStore,
  StoredOperation,
  StoredProof,
  UnixSeconds,
} from "@linky/linkshu";
import { Effect, Layer, Schema } from "effect";

const SeedJson = Schema.parseJson(
  Schema.Array(Schema.Int.pipe(Schema.between(0, 255))).pipe(
    Schema.itemsCount(64),
  ),
);
const ProofsJson = Schema.parseJson(Schema.Array(StoredProof));
const OperationsJson = Schema.parseJson(Schema.Array(StoredOperation));
const LeaseJson = Schema.parseJson(
  Schema.Struct({ lease: LeaseId, expiresAtMs: Schema.Number }),
);

const nowSeconds = () => UnixSeconds.make(Math.floor(Date.now() / 1000));

export const walletStorage = (prefix: string) => {
  const seedKey = `${prefix}.seed`;
  const storedSeed = localStorage.getItem(seedKey);
  const seed =
    storedSeed === null
      ? Array.from(crypto.getRandomValues(new Uint8Array(64)))
      : Schema.decodeUnknownSync(SeedJson)(storedSeed);
  if (storedSeed === null)
    localStorage.setItem(seedKey, Schema.encodeSync(SeedJson)(seed));
  const proofsKey = `${prefix}.proofs`;
  const loadProofs = () =>
    Schema.decodeUnknownSync(ProofsJson)(
      localStorage.getItem(proofsKey) ?? "[]",
    );
  const saveProofs = (rows: readonly StoredProof[]) =>
    localStorage.setItem(proofsKey, Schema.encodeSync(ProofsJson)(rows));
  const operationsKey = `${prefix}.operations`;
  const loadOperations = () =>
    Schema.decodeUnknownSync(OperationsJson)(
      localStorage.getItem(operationsKey) ?? "[]",
    );
  const saveOperations = (rows: readonly StoredOperation[]) =>
    localStorage.setItem(
      operationsKey,
      Schema.encodeSync(OperationsJson)(rows),
    );
  const readLease = (key: string) => {
    const raw = localStorage.getItem(`${prefix}.lease.${key}`);
    return raw === null ? null : Schema.decodeUnknownSync(LeaseJson)(raw);
  };
  return {
    bip39Seed: Bip39Seed.make(Uint8Array.from(seed)),
    proofStore: Layer.succeed(ProofStore, {
      loadAll: Effect.sync(loadProofs),
      insert: (proofs) =>
        Effect.sync(() => {
          const byId = new Map(loadProofs().map((row) => [row.id, row]));
          const stored = proofs.map((proof) => {
            const id = ProofId.make(deriveStoreId(proof.secret));
            const row = new StoredProof({
              ...proof,
              id,
              createdAt: byId.get(id)?.createdAt ?? nowSeconds(),
            });
            byId.set(id, row);
            return row;
          });
          saveProofs([...byId.values()]);
          return stored;
        }),
      update: (id, patch) =>
        Effect.sync(() =>
          saveProofs(
            loadProofs().map((row) =>
              row.id === id ? applyProofPatch(row, patch) : row,
            ),
          ),
        ),
    }),
    operationStore: Layer.succeed(OperationStore, {
      loadAll: Effect.sync(loadOperations),
      insert: (operation) =>
        Effect.sync(() => {
          const id = OperationId.make(deriveStoreId(operationKeyOf(operation)));
          const stored = new StoredOperation({ ...operation, id });
          saveOperations([
            ...loadOperations().filter((row) => row.id !== id),
            stored,
          ]);
          return stored;
        }),
      update: (id, patch) =>
        Effect.sync(() =>
          saveOperations(
            loadOperations().map((row) =>
              row.id === id ? applyOperationPatch(row, patch) : row,
            ),
          ),
        ),
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
