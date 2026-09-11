import { Effect, Layer } from "effect";
import { OperationId } from "../domain/primitives";
import { deriveStoreId } from "./ids";
import {
  operationKeyOf,
  OperationStore,
  StoredOperation,
} from "./OperationStore";
import type { OperationPatch, OperationStoreService } from "./OperationStore";

export const applyOperationPatch = (
  operation: StoredOperation,
  patch: OperationPatch,
): StoredOperation =>
  new StoredOperation({
    ...operation,
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.counter !== undefined ? { counter: patch.counter } : {}),
    ...(patch.error !== undefined ? { error: patch.error } : {}),
  });

/** One non-durable store instance; see `makeInMemoryKeyValueStore`. */
export const makeInMemoryOperationStore = (): OperationStoreService => {
  const operations = new Map<OperationId, StoredOperation>();
  return {
    insert: (operation) =>
      Effect.sync(() => {
        const id = OperationId.make(deriveStoreId(operationKeyOf(operation)));
        const stored = new StoredOperation({ ...operation, id });
        operations.set(id, stored);
        return stored;
      }),
    update: (id, patch) =>
      Effect.sync(() => {
        const current = operations.get(id);
        if (current !== undefined)
          operations.set(id, applyOperationPatch(current, patch));
      }),
    loadAll: Effect.sync(() => [...operations.values()]),
  };
};

/** Non-durable, single-process; for tests and quick experiments. */
export const inMemoryOperationStore: Layer.Layer<OperationStore> = Layer.sync(
  OperationStore,
  makeInMemoryOperationStore,
);
