import {
  NonEmptyString,
  NonEmptyString100,
  NonEmptyString1000,
  NonNegativeInt,
  PositiveInt,
  sqliteFalse,
  sqliteTrue,
} from "@evolu/common";
import {
  OperationId,
  operationKeyOf,
  OperationStore,
  ProofId,
  ProofStore,
  StoredOperation,
  StoredProof,
  UnixSeconds,
} from "@linky/linkshu";
import type {
  NewOperation,
  NewProof,
  OperationPatch,
  OperationStoreService,
  ProofPatch,
  ProofStoreService,
} from "@linky/linkshu";
import { Effect, Layer, Schema } from "effect";
import type { Patch, Row, WriteRow } from "../core";
import {
  CashuOperationId,
  cashuOperationIdFor,
  CashuProofId,
  cashuProofIdFor,
} from "../model/ids";
import type {
  CashuOperationRow,
  CashuProofRow,
  LinkyDbSchema,
} from "../model/schema";
import type { LinkyStore } from "../model/store";
import { tableRepository } from "./tableRepository";

/**
 * Linkshu's `ProofStore` and `OperationStore` ports over the cashu scope.
 * Ids derive from the proof secret and the operation key, so every device
 * converges on one row; the shard store keeps updates on the active shard
 * (copy-on-write), which is what makes an update of a proof born in an old
 * shard land where it belongs instead of creating a phantom row.
 *
 * Two devices can still leave two copies of one proof in different shards
 * (both wrote it while one of them had not yet seen a rotation), and a
 * copy-forward can tombstone a copy another device marks spent afterwards.
 * `spent` is terminal, so a proof reads as spent when any copy in any
 * visible shard says so, tombstoned or not; the next update patches the
 * copy that wins the ordinary merge and the copies agree again.
 */

const decodeStoredProof = Schema.decodeUnknownOption(StoredProof);
const decodeStoredOperation = Schema.decodeUnknownOption(StoredOperation);

const isoToUnixSeconds = (iso: string): number =>
  Math.max(1, Math.floor(Date.parse(iso) / 1000));

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
    createdAt: isoToUnixSeconds(row.createdAt),
  });
  return decoded._tag === "Some" ? decoded.value : null;
};

export const toStoredOperation = (
  row: CashuOperationRow,
): StoredOperation | null => {
  const decoded = decodeStoredOperation({
    id: row.id,
    kind: row.kind,
    status: row.status,
    mint: row.mint,
    unit: row.unit,
    keysetId: row.keysetId,
    amount: row.amount,
    feeReserve: row.feeReserve,
    inputsTotal: row.inputsTotal,
    quoteId: row.quoteId,
    invoice: row.invoice,
    sourceMint: row.sourceMint,
    counter: row.counter,
    locked: row.locked === null ? null : row.locked === sqliteTrue,
    expiresAt: row.expiresAtSec,
    createdAt: row.createdAtSec,
    tokenText: row.tokenText,
    error: row.error,
  });
  return decoded._tag === "Some" ? decoded.value : null;
};

const toOperationIdColumn = (
  operationId: string | null,
): CashuOperationId | null => {
  if (operationId === null) return null;
  const decoded = CashuOperationId.fromUnknown(operationId);
  if (!decoded.ok) throw new Error("cashuProof operationId is not an Evolu id");
  return decoded.value;
};

const toOperationIdOrThrow = (id: string): CashuOperationId => {
  const decoded = CashuOperationId.fromUnknown(id);
  if (!decoded.ok) throw new Error("cashuOperation id is not an Evolu id");
  return decoded.value;
};

type ProofColumns = WriteRow<LinkyDbSchema["cashuProof"]>;
type OperationColumns = WriteRow<LinkyDbSchema["cashuOperation"]>;

const toProofColumns = (proof: NewProof, id: CashuProofId): ProofColumns => ({
  id,
  mint: NonEmptyString1000.orThrow(proof.mint),
  unit: NonEmptyString100.orThrow(proof.unit),
  keysetId: NonEmptyString100.orThrow(proof.keysetId),
  amount: PositiveInt.orThrow(proof.amount),
  secret: NonEmptyString1000.orThrow(proof.secret),
  c: NonEmptyString1000.orThrow(proof.C),
  ...(proof.dleq !== null
    ? { dleq: NonEmptyString1000.orThrow(proof.dleq) }
    : {}),
  state: NonEmptyString100.orThrow(proof.state),
  ...(proof.operationId !== null
    ? { operationId: toOperationIdOrThrow(proof.operationId) }
    : {}),
});

/** One row per id: the highest shard's copy as the core merges, unless any copy is spent. */
export const mergeProofCopies = (
  copies: ReadonlyArray<Row<LinkyDbSchema["cashuProof"]>>,
): ReadonlyArray<Row<LinkyDbSchema["cashuProof"]>> => {
  const byId = new Map<string, Row<LinkyDbSchema["cashuProof"]>>();
  for (const copy of copies) {
    const current = byId.get(copy.id);
    if (
      current === undefined ||
      (copy.state === "spent" && current.state !== "spent")
    )
      byId.set(copy.id, copy);
  }
  return [...byId.values()].filter(
    (row) => row.state === "spent" || row.isDeleted !== 1,
  );
};

const toProofPatch = (
  patch: ProofPatch,
): Patch<LinkyDbSchema["cashuProof"]> => ({
  ...(patch.state !== undefined
    ? { state: NonEmptyString100.orThrow(patch.state) }
    : {}),
  ...(patch.operationId !== undefined
    ? { operationId: toOperationIdColumn(patch.operationId) }
    : {}),
});

// The error column caps at 1000 chars; a longer serialized error is cut.
const toErrorColumn = (error: string | null) => {
  const text = (error ?? "").trim().slice(0, 1000);
  return text ? NonEmptyString1000.orThrow(text) : null;
};

const withError = (error: ReturnType<typeof toErrorColumn>) =>
  error === null ? {} : { error };

const toOperationColumns = (
  operation: NewOperation,
  id: CashuOperationId,
): OperationColumns => ({
  id,
  ...withError(toErrorColumn(operation.error)),
  kind: NonEmptyString100.orThrow(operation.kind),
  status: NonEmptyString100.orThrow(operation.status),
  mint: NonEmptyString1000.orThrow(operation.mint),
  unit: NonEmptyString100.orThrow(operation.unit),
  ...(operation.keysetId !== null
    ? { keysetId: NonEmptyString100.orThrow(operation.keysetId) }
    : {}),
  amount: PositiveInt.orThrow(operation.amount),
  ...(operation.feeReserve !== null
    ? { feeReserve: NonNegativeInt.orThrow(operation.feeReserve) }
    : {}),
  ...(operation.inputsTotal !== null
    ? { inputsTotal: PositiveInt.orThrow(operation.inputsTotal) }
    : {}),
  ...(operation.quoteId !== null
    ? { quoteId: NonEmptyString1000.orThrow(operation.quoteId) }
    : {}),
  ...(operation.invoice !== null
    ? { invoice: NonEmptyString.orThrow(operation.invoice) }
    : {}),
  ...(operation.sourceMint !== null
    ? { sourceMint: NonEmptyString1000.orThrow(operation.sourceMint) }
    : {}),
  ...(operation.counter !== null
    ? { counter: NonNegativeInt.orThrow(operation.counter) }
    : {}),
  ...(operation.locked !== null
    ? { locked: operation.locked ? sqliteTrue : sqliteFalse }
    : {}),
  ...(operation.expiresAt !== null
    ? { expiresAtSec: PositiveInt.orThrow(operation.expiresAt) }
    : {}),
  createdAtSec: PositiveInt.orThrow(operation.createdAt),
  ...(operation.tokenText !== null
    ? { tokenText: NonEmptyString.orThrow(operation.tokenText) }
    : {}),
});

const toOperationPatch = (
  patch: OperationPatch,
): Patch<LinkyDbSchema["cashuOperation"]> => ({
  ...(patch.status !== undefined
    ? { status: NonEmptyString100.orThrow(patch.status) }
    : {}),
  ...(patch.counter !== undefined
    ? { counter: NonNegativeInt.orThrow(patch.counter) }
    : {}),
  ...(patch.error !== undefined ? { error: toErrorColumn(patch.error) } : {}),
});

/** The ports say "unknown id: no-op"; an id that is not even an Evolu id cannot be stored, so it is unknown too. */
const patchKnownRow = <Id, E extends { readonly _tag: string }>(
  decoded: { readonly ok: true; readonly value: Id } | { readonly ok: false },
  apply: (id: Id) => Effect.Effect<void, E>,
): Effect.Effect<void> =>
  !decoded.ok
    ? Effect.void
    : apply(decoded.value).pipe(
        Effect.catchIf(
          (error) => error._tag === "RowNotFound",
          () => Effect.void,
        ),
        Effect.orDie,
      );

export interface WalletRepository {
  readonly proofs: ProofStoreService;
  readonly operations: OperationStoreService;
  readonly proofStore: Layer.Layer<ProofStore>;
  readonly operationStore: Layer.Layer<OperationStore>;
  readonly subscribe: (listener: () => void) => () => void;
}

export const makeWalletRepository = (store: LinkyStore): WalletRepository => {
  const proofTable = tableRepository(store, "cashu", "cashuProof");
  const operationTable = tableRepository(store, "cashu", "cashuOperation");

  const proofs: ProofStoreService = {
    // One rotation check for the whole batch, not one per proof.
    insert: (rows) =>
      Effect.gen(function* () {
        const existing = new Map(
          (yield* proofTable.all).map((row) => [row.id, row]),
        );
        const stored: StoredProof[] = [];
        for (const proof of rows) {
          const id = cashuProofIdFor(proof.secret);
          const previous = existing.get(id);
          const columns = toProofColumns(proof, id);
          yield* previous === undefined
            ? store.insert("cashu", "cashuProof", columns)
            : store.update("cashu", "cashuProof", id, columns);
          const persisted = previous ?? (yield* proofTable.byId(id));
          if (persisted === null)
            return yield* Effect.dieMessage("proof vanished after insert");
          stored.push(
            new StoredProof({
              ...proof,
              id: ProofId.make(id),
              createdAt: UnixSeconds.make(
                isoToUnixSeconds(persisted.createdAt),
              ),
            }),
          );
        }
        yield* proofTable.maybeRotate;
        return stored;
      }).pipe(Effect.orDie),
    update: (id, patch) =>
      patchKnownRow(CashuProofId.fromUnknown(id), (proofId) =>
        proofTable.update(proofId, toProofPatch(patch)),
      ),
    loadAll: Effect.map(store.copies("cashu", "cashuProof"), (copies) =>
      mergeProofCopies(copies).flatMap((row) => {
        const stored = toStoredProof(row);
        return stored === null ? [] : [stored];
      }),
    ),
  };

  const operations: OperationStoreService = {
    insert: (operation) =>
      Effect.gen(function* () {
        const id = cashuOperationIdFor(operationKeyOf(operation));
        const previous = yield* operationTable.byId(id);
        const columns = toOperationColumns(operation, id);
        yield* previous === null
          ? operationTable.insert(columns)
          : operationTable.update(id, columns);
        return new StoredOperation({ ...operation, id: OperationId.make(id) });
      }).pipe(Effect.orDie),
    update: (id, patch) =>
      patchKnownRow(CashuOperationId.fromUnknown(id), (operationId) =>
        operationTable.update(operationId, toOperationPatch(patch)),
      ),
    loadAll: Effect.map(operationTable.all, (rows) =>
      rows.flatMap((row) => {
        const stored = toStoredOperation(row);
        return stored === null ? [] : [stored];
      }),
    ),
  };

  return {
    proofs,
    operations,
    proofStore: Layer.succeed(ProofStore, proofs),
    operationStore: Layer.succeed(OperationStore, operations),
    subscribe: proofTable.subscribe,
  };
};
