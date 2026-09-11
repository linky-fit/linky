import { Clock, Effect, Layer } from "effect";
import { ProofId, UnixSeconds } from "../domain/primitives";
import { deriveStoreId } from "./ids";
import { ProofStore, StoredProof } from "./ProofStore";
import type { ProofPatch, ProofStoreService } from "./ProofStore";

export const applyProofPatch = (
  proof: StoredProof,
  patch: ProofPatch,
): StoredProof =>
  new StoredProof({
    ...proof,
    ...(patch.state !== undefined ? { state: patch.state } : {}),
    ...(patch.operationId !== undefined
      ? { operationId: patch.operationId }
      : {}),
  });

/** One non-durable store instance; see `makeInMemoryKeyValueStore`. */
export const makeInMemoryProofStore = (): ProofStoreService => {
  const proofs = new Map<ProofId, StoredProof>();
  return {
    insert: (rows) =>
      Effect.map(Clock.currentTimeMillis, (millis) =>
        rows.map((row) => {
          const id = ProofId.make(deriveStoreId(row.secret));
          const stored = new StoredProof({
            ...row,
            id,
            createdAt:
              proofs.get(id)?.createdAt ??
              UnixSeconds.make(Math.floor(millis / 1000)),
          });
          proofs.set(id, stored);
          return stored;
        }),
      ),
    update: (id, patch) =>
      Effect.sync(() => {
        const current = proofs.get(id);
        if (current !== undefined)
          proofs.set(id, applyProofPatch(current, patch));
      }),
    loadAll: Effect.sync(() => [...proofs.values()]),
  };
};

/** Non-durable, single-process; for tests and quick experiments. */
export const inMemoryProofStore: Layer.Layer<ProofStore> = Layer.sync(
  ProofStore,
  makeInMemoryProofStore,
);
