import {
  applyProofPatch,
  deriveStoreId,
  ProofId,
  ProofStore,
  StoredProof,
  UnixSeconds,
} from "@linky/linkshu";
import type { ProofStoreService } from "@linky/linkshu";
import { Clock, Effect, Layer, Schema } from "effect";
import { makeJsonFile } from "./jsonFile";

/**
 * The `ProofStore` port over a JSON array of the port's own row schema, so
 * the file is exactly the inventory the package handed over — no adapter
 * mapping to drift, and the wallet stays readable with any text editor.
 * Ids derive from the secret, so inserting a stored secret replaces its row.
 */
const ProofFile = Schema.Array(StoredProof);

export const makeFileProofStore = (filePath: string): ProofStoreService => {
  const file = makeJsonFile(filePath, ProofFile, []);
  return {
    insert: (proofs) =>
      Effect.flatMap(Clock.currentTimeMillis, (millis) =>
        file.modify((rows) => {
          const byId = new Map(rows.map((row) => [row.id, row]));
          const stored = proofs.map((proof) => {
            const id = ProofId.make(deriveStoreId(proof.secret));
            const row = new StoredProof({
              ...proof,
              id,
              createdAt:
                byId.get(id)?.createdAt ??
                UnixSeconds.make(Math.floor(millis / 1000)),
            });
            byId.set(id, row);
            return row;
          });
          return [[...byId.values()], stored];
        }),
      ),

    update: (id, patch) =>
      file.modify((rows) => [
        rows.map((row) => (row.id === id ? applyProofPatch(row, patch) : row)),
        undefined,
      ]),

    loadAll: file.read,
  };
};

export const fileProofStore = (filePath: string): Layer.Layer<ProofStore> =>
  Layer.sync(ProofStore, () => makeFileProofStore(filePath));
