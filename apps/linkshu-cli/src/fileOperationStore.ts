import {
  applyOperationPatch,
  deriveStoreId,
  OperationId,
  operationKeyOf,
  OperationStore,
  StoredOperation,
} from "@linky/linkshu";
import type { OperationStoreService } from "@linky/linkshu";
import { Layer, Schema } from "effect";
import { makeJsonFile } from "./jsonFile";

/**
 * The `OperationStore` port over a JSON array of the port's own row schema.
 * Ids derive from the operation key, so inserting an existing operation
 * replaces its row.
 */
const OperationFile = Schema.Array(StoredOperation);

export const makeFileOperationStore = (
  filePath: string,
): OperationStoreService => {
  const file = makeJsonFile(filePath, OperationFile, []);
  return {
    insert: (operation) =>
      file.modify((rows) => {
        const id = OperationId.make(deriveStoreId(operationKeyOf(operation)));
        const stored = new StoredOperation({ ...operation, id });
        return [[...rows.filter((row) => row.id !== id), stored], stored];
      }),

    update: (id, patch) =>
      file.modify((rows) => [
        rows.map((row) =>
          row.id === id ? applyOperationPatch(row, patch) : row,
        ),
        undefined,
      ]),

    loadAll: file.read,
  };
};

export const fileOperationStore = (
  filePath: string,
): Layer.Layer<OperationStore> =>
  Layer.sync(OperationStore, () => makeFileOperationStore(filePath));
