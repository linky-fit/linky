import { makeInMemoryKeyValueStore } from "../ports/inMemoryKeyValueStore";
import { makeInMemoryOperationStore } from "../ports/inMemoryOperationStore";
import { makeInMemoryProofStore } from "../ports/inMemoryProofStore";
import type { KeyValueStoreService } from "../ports/KeyValueStore";
import type { OperationStoreService } from "../ports/OperationStore";
import type { ProofStoreService } from "../ports/ProofStore";

/** Ports that outlive one runtime; a second runtime over them models a restart. */
export interface Storage {
  readonly kv: KeyValueStoreService;
  readonly proofs: ProofStoreService;
  readonly operations: OperationStoreService;
}

export const freshStorage = (): Storage => ({
  kv: makeInMemoryKeyValueStore(),
  proofs: makeInMemoryProofStore(),
  operations: makeInMemoryOperationStore(),
});
