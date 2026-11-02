import { Clock, Effect, Layer } from "effect";
import { ProofId, UnixSeconds } from "../domain/primitives";
import { deriveStoreId } from "./ids";
import { ProofStore, StoredProof } from "./ProofStore";
import type { ProofPatch, ProofStoreService, ProofWrite } from "./ProofStore";

const applyProofPatch = (proof: StoredProof, patch: ProofPatch): StoredProof =>
  new StoredProof({
    ...proof,
    ...(patch.state !== undefined ? { state: patch.state } : {}),
    ...(patch.operationId !== undefined
      ? { operationId: patch.operationId }
      : {}),
  });

/**
 * Applies a `ProofStore.write` batch to rows keyed by id and returns the
 * inserted proofs, so an adapter that holds its rows in memory or in one
 * file implements `write` as load, apply, save.
 */
export const applyProofWrite = (
  rows: Map<ProofId, StoredProof>,
  batch: ProofWrite,
  now: UnixSeconds,
): ReadonlyArray<StoredProof> => {
  const stored = (batch.insert ?? []).map((proof) => {
    const id = ProofId.make(deriveStoreId(proof.secret));
    const row = new StoredProof({
      ...proof,
      id,
      createdAt: rows.get(id)?.createdAt ?? now,
    });
    rows.set(id, row);
    return row;
  });
  for (const { id, patch } of batch.update ?? []) {
    const current = rows.get(id);
    if (current !== undefined) rows.set(id, applyProofPatch(current, patch));
  }
  return stored;
};

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
    write: (batch) =>
      Effect.map(Clock.currentTimeMillis, (millis) =>
        applyProofWrite(
          proofs,
          batch,
          UnixSeconds.make(Math.floor(millis / 1000)),
        ),
      ),
    ...proofReadsOf(all),
    all,
  };
};

/** Non-durable, single-process; for tests and quick experiments. */
export const inMemoryProofStore: Layer.Layer<ProofStore> = Layer.sync(
  ProofStore,
  makeInMemoryProofStore,
);
