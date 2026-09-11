import * as Evolu from "@evolu/common";
import {
  applyProofPatch,
  ProofId,
  ProofStore,
  StoredProof,
  UnixSeconds,
} from "@linky/linkshu";
import type { ProofPatch, ProofStoreService } from "@linky/linkshu";
import { Effect, Layer, Schema } from "effect";
import type {
  CashuOperationId,
  CashuProofId,
  CashuProofRow,
} from "../../evolu";
import { nowSeconds } from "../../utils/time";
import { makeWriteOverlay } from "./evoluWriteOverlay";

/**
 * Linkshu's `ProofStore` port over the Evolu `cashuProof` table. Ids derive
 * from the proof secret (`createIdFromString`), inserts go to the active
 * cashu lane, updates target the lane the row lives in, and a write overlay
 * bridges the lag of the React read model (see `evoluWriteOverlay.ts`).
 */

export const createCashuProofId = (secret: string): CashuProofId =>
  Evolu.createIdFromString<"CashuProof">(secret);

type EvoluMutationResult =
  | { readonly ok: true }
  | { readonly error: unknown; readonly ok: false };

interface EvoluCashuProofInsertPayload {
  readonly amount: typeof Evolu.PositiveInt.Type;
  readonly c: typeof Evolu.NonEmptyString1000.Type;
  readonly dleq?: typeof Evolu.NonEmptyString1000.Type;
  readonly id: CashuProofId;
  readonly keysetId: typeof Evolu.NonEmptyString100.Type;
  readonly mint: typeof Evolu.NonEmptyString1000.Type;
  readonly operationId?: CashuOperationId;
  readonly secret: typeof Evolu.NonEmptyString1000.Type;
  readonly state: typeof Evolu.NonEmptyString100.Type;
  readonly unit: typeof Evolu.NonEmptyString100.Type;
}

interface EvoluCashuProofUpdatePayload {
  readonly id: CashuProofId;
  readonly operationId?: CashuOperationId | null;
  readonly state?: typeof Evolu.NonEmptyString100.Type;
}

export type EvoluCashuProofUpsert = (
  table: "cashuProof",
  payload: EvoluCashuProofInsertPayload,
  options: { readonly ownerId: Evolu.OwnerId },
) => EvoluMutationResult;

export type EvoluCashuProofUpdate = (
  table: "cashuProof",
  payload: EvoluCashuProofUpdatePayload,
  options: { readonly ownerId: Evolu.OwnerId },
) => EvoluMutationResult;

interface EvoluProofStoreDeps {
  /** Proof rows visible to the wallet, across cashu owner lanes, deduped by id. */
  readonly loadProofRows: () => ReadonlyArray<CashuProofRow>;
  readonly update: EvoluCashuProofUpdate;
  readonly upsert: EvoluCashuProofUpsert;
  /** Active cashu write lane; new rows are inserted there. */
  readonly getWriteOwnerId: () => Evolu.OwnerId;
}

const decodeStoredProof = Schema.decodeUnknownOption(StoredProof);

/** A stored row in the port's shape; `null` for a row that does not validate. */
export const toStoredProof = (row: CashuProofRow): StoredProof | null => {
  const decoded = decodeStoredProof({
    id: row.id,
    mint: row.mint,
    unit: row.unit,
    keysetId: row.keysetId,
    amount: row.amount,
    secret: row.secret,
    C: row.c,
    dleq: row.dleq,
    state: row.state,
    operationId: row.operationId,
    createdAt: Math.max(1, Math.floor(Date.parse(row.createdAt) / 1000)),
  });
  return decoded._tag === "Some" ? decoded.value : null;
};

const decodeOperationId = Evolu.id("CashuOperation");
const decodeProofId = Evolu.id("CashuProof");

const toOperationIdColumn = (
  operationId: string | null,
): CashuOperationId | null => {
  if (operationId === null) return null;
  const decoded = decodeOperationId.fromUnknown(operationId);
  if (!decoded.ok) throw new Error("cashuProof operationId is not an Evolu id");
  return decoded.value;
};

const toProofIdColumn = (id: string): CashuProofId => {
  const decoded = decodeProofId.fromUnknown(id);
  if (!decoded.ok) throw new Error("cashuProof id is not an Evolu id");
  return decoded.value;
};

const reflectsWrite = (loaded: StoredProof, written: StoredProof): boolean =>
  loaded.state === written.state && loaded.operationId === written.operationId;

export const makeEvoluProofStore = (
  deps: EvoluProofStoreDeps,
): ProofStoreService => {
  const overlay = makeWriteOverlay<StoredProof>(reflectsWrite);

  const loaded = (): Array<{ row: StoredProof; lane: Evolu.OwnerId }> =>
    deps.loadProofRows().flatMap((row) => {
      const stored = toStoredProof(row);
      return stored === null ? [] : [{ row: stored, lane: row.ownerId }];
    });

  const runUpdate = (
    payload: EvoluCashuProofUpdatePayload,
    ownerId: Evolu.OwnerId,
  ): void => {
    const result = deps.update("cashuProof", payload, { ownerId });
    if (!result.ok) {
      throw new Error(`cashuProof update failed: ${String(result.error)}`);
    }
  };

  const toUpdatePayload = (
    id: CashuProofId,
    patch: ProofPatch,
  ): EvoluCashuProofUpdatePayload => ({
    id,
    ...(patch.state !== undefined
      ? { state: Evolu.NonEmptyString100.orThrow(patch.state) }
      : {}),
    ...(patch.operationId !== undefined
      ? { operationId: toOperationIdColumn(patch.operationId) }
      : {}),
  });

  return {
    insert: (proofs) =>
      Effect.sync(() => {
        const lane = deps.getWriteOwnerId();
        const existing = new Map(
          loaded().map((entry) => [String(entry.row.id), entry]),
        );
        return proofs.map((proof) => {
          const id = createCashuProofId(proof.secret);
          const previous = existing.get(id);
          const operationId = toOperationIdColumn(proof.operationId);
          const result = deps.upsert(
            "cashuProof",
            {
              id,
              mint: Evolu.NonEmptyString1000.orThrow(proof.mint),
              unit: Evolu.NonEmptyString100.orThrow(proof.unit),
              keysetId: Evolu.NonEmptyString100.orThrow(proof.keysetId),
              amount: Evolu.PositiveInt.orThrow(proof.amount),
              secret: Evolu.NonEmptyString1000.orThrow(proof.secret),
              c: Evolu.NonEmptyString1000.orThrow(proof.C),
              ...(proof.dleq !== null
                ? { dleq: Evolu.NonEmptyString1000.orThrow(proof.dleq) }
                : {}),
              state: Evolu.NonEmptyString100.orThrow(proof.state),
              ...(operationId !== null ? { operationId } : {}),
            },
            { ownerId: previous?.lane ?? lane },
          );
          if (!result.ok) {
            throw new Error(
              `cashuProof upsert failed: ${String(result.error)}`,
            );
          }
          const stored = new StoredProof({
            ...proof,
            id: ProofId.make(id),
            createdAt:
              previous?.row.createdAt ?? UnixSeconds.make(nowSeconds()),
          });
          overlay.set(stored, previous?.lane ?? lane);
          return stored;
        });
      }),

    update: (id, patch) =>
      Effect.sync(() => {
        const entry =
          overlay.get(id) ??
          loaded().find((candidate) => candidate.row.id === id);
        if (entry === undefined) return;
        runUpdate(toUpdatePayload(toProofIdColumn(id), patch), entry.lane);
        overlay.set(applyProofPatch(entry.row, patch), entry.lane);
      }),

    loadAll: Effect.sync(() =>
      overlay.merge(loaded().map((entry) => entry.row)),
    ),
  };
};

export const evoluProofStore = (
  deps: EvoluProofStoreDeps,
): Layer.Layer<ProofStore> =>
  Layer.sync(ProofStore, () => makeEvoluProofStore(deps));
