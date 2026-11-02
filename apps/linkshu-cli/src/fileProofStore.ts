import {
  applyProofWrite,
  ProofStore,
  proofReadsOf,
  StoredProof,
  UnixSeconds,
} from "@linky-fit/linkshu";
import type { ProofStoreService } from "@linky-fit/linkshu";
import { Clock, Effect, Layer, Schema } from "effect";
import { makeJsonFile } from "./jsonFile";

/**
 * The `ProofStore` port over a JSON array of the port's own row schema, so
 * the file is exactly the inventory the package handed over — no adapter
 * mapping to drift, and the wallet stays readable with any text editor.
 * Ids derive from the secret, so inserting a stored secret replaces its row,
 * and a write batch is one file write.
 */
const ProofFile = Schema.Array(StoredProof);

export const makeFileProofStore = (filePath: string): ProofStoreService => {
  const file = makeJsonFile(filePath, ProofFile, []);
  return {
    write: (batch) =>
      Effect.flatMap(Clock.currentTimeMillis, (millis) =>
        file.modify((rows) => {
          const byId = new Map(rows.map((row) => [row.id, row]));
          const stored = applyProofWrite(
            byId,
            batch,
            UnixSeconds.make(Math.floor(millis / 1000)),
          );
          return [[...byId.values()], stored];
        }),
      ),

    ...proofReadsOf(file.read),
  };
};

export const fileProofStore = (filePath: string): Layer.Layer<ProofStore> =>
  Layer.sync(ProofStore, () => makeFileProofStore(filePath));
