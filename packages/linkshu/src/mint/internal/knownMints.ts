import { Effect } from "effect";
import { parseMintUrl } from "../../domain/primitives";
import type { MintUrl } from "../../domain/primitives";
import type { KeyValueStoreService } from "../../ports/KeyValueStore";
import type { OperationStoreService } from "../../ports/OperationStore";
import type { ProofStoreService } from "../../ports/ProofStore";
import { SEEN_MINTS_KEY_PREFIX } from "./WalletInstances";

/**
 * Every mint the wallet has state for: the mints of stored proofs and
 * operations plus the mints any wallet load has seen. Restore scans these
 * when the caller names none.
 */
export const collectKnownMints = (
  kv: KeyValueStoreService,
  proofStore: ProofStoreService,
  operationStore: OperationStoreService,
): Effect.Effect<ReadonlyArray<MintUrl>> =>
  Effect.gen(function* () {
    const mints = new Set<MintUrl>();
    for (const proof of yield* proofStore.loadAll) mints.add(proof.mint);
    for (const operation of yield* operationStore.loadAll) {
      mints.add(operation.mint);
      if (operation.sourceMint !== null) mints.add(operation.sourceMint);
    }
    for (const key of yield* kv.listKeys(SEEN_MINTS_KEY_PREFIX)) {
      const value = yield* kv.get(key);
      const mint = value === null ? null : parseMintUrl(value);
      if (mint !== null) mints.add(mint);
    }
    return [...mints].sort();
  });
