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

type ProofReads = Pick<
  ProofStoreService,
  "loadUnspent" | "findBySecrets" | "findByOperation" | "findOldestByKeysets"
>;

/**
 * The read methods of `ProofStoreService` over a store small enough to load
 * every proof, any state, for each read: a file or `localStorage` adapter.
 */
export const proofReadsOf = (
  loadAll: Effect.Effect<ReadonlyArray<StoredProof>>,
): ProofReads => {
  const filtered = (keep: (proof: StoredProof) => boolean) =>
    Effect.map(loadAll, (proofs) => proofs.filter(keep));
  return {
    loadUnspent: filtered((proof) => proof.state !== "spent"),
    findBySecrets: (secrets) => {
      const wanted = new Set(secrets);
      return filtered((proof) => wanted.has(proof.secret));
    },
    findByOperation: (operationId) =>
      filtered((proof) => proof.operationId === operationId),
    findOldestByKeysets: (keysetIds) => {
      const wanted = new Set<string>(keysetIds);
      return Effect.map(loadAll, (proofs) => {
        const oldest = new Map<string, StoredProof>();
        for (const proof of proofs) {
          const current = oldest.get(proof.keysetId);
          if (
            wanted.has(proof.keysetId) &&
            (current === undefined || proof.createdAt < current.createdAt)
          )
            oldest.set(proof.keysetId, proof);
        }
        return [...oldest.values()];
      });
    },
  };
};

/** One non-durable store; `all` lists every proof, any state, for inspection. */
export interface InMemoryProofStore extends ProofStoreService {
  readonly all: Effect.Effect<ReadonlyArray<StoredProof>>;
}

/** One non-durable store instance; see `makeInMemoryKeyValueStore`. */
export const makeInMemoryProofStore = (): InMemoryProofStore => {
  const proofs = new Map<ProofId, StoredProof>();
  const all = Effect.sync(() => [...proofs.values()]);
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
    ...proofReadsOf(all),
    all,
  };
};

/** Non-durable, single-process; for tests and quick experiments. */
export const inMemoryProofStore: Layer.Layer<ProofStore> = Layer.sync(
  ProofStore,
  makeInMemoryProofStore,
);
