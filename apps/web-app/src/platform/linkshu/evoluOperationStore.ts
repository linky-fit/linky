import * as Evolu from "@evolu/common";
import {
  applyOperationPatch,
  OperationId,
  operationKeyOf,
  OperationStore,
  StoredOperation,
} from "@linky/linkshu";
import type { OperationPatch, OperationStoreService } from "@linky/linkshu";
import { Effect, Layer, Schema } from "effect";
import type { CashuOperationId, CashuOperationRow } from "../../evolu";
import { makeWriteOverlay } from "./evoluWriteOverlay";

/**
 * Linkshu's `OperationStore` port over the Evolu `cashuOperation` table. Ids
 * derive from the operation key (`createIdFromString`), inserts go to the
 * active cashu lane, updates target the lane the row lives in, and a write
 * overlay bridges the lag of the React read model.
 */

export const createCashuOperationId = (key: string): CashuOperationId =>
  Evolu.createIdFromString<"CashuOperation">(key);

type EvoluMutationResult =
  | { readonly ok: true }
  | { readonly error: unknown; readonly ok: false };

interface EvoluCashuOperationInsertPayload {
  readonly amount: typeof Evolu.PositiveInt.Type;
  readonly counter?: typeof Evolu.NonNegativeInt.Type;
  readonly createdAtSec: typeof Evolu.PositiveInt.Type;
  readonly error?: typeof Evolu.NonEmptyString1000.Type;
  readonly expiresAtSec?: typeof Evolu.PositiveInt.Type;
  readonly feeReserve?: typeof Evolu.NonNegativeInt.Type;
  readonly id: CashuOperationId;
  readonly inputsTotal?: typeof Evolu.PositiveInt.Type;
  readonly invoice?: typeof Evolu.NonEmptyString.Type;
  readonly keysetId?: typeof Evolu.NonEmptyString100.Type;
  readonly kind: typeof Evolu.NonEmptyString100.Type;
  readonly locked?: typeof Evolu.SqliteBoolean.Type;
  readonly mint: typeof Evolu.NonEmptyString1000.Type;
  readonly quoteId?: typeof Evolu.NonEmptyString1000.Type;
  readonly sourceMint?: typeof Evolu.NonEmptyString1000.Type;
  readonly status: typeof Evolu.NonEmptyString100.Type;
  readonly tokenText?: typeof Evolu.NonEmptyString.Type;
  readonly unit: typeof Evolu.NonEmptyString100.Type;
}

interface EvoluCashuOperationUpdatePayload {
  readonly counter?: typeof Evolu.NonNegativeInt.Type;
  readonly error?: typeof Evolu.NonEmptyString1000.Type | null;
  readonly id: CashuOperationId;
  readonly status?: typeof Evolu.NonEmptyString100.Type;
}

export type EvoluCashuOperationUpsert = (
  table: "cashuOperation",
  payload: EvoluCashuOperationInsertPayload,
  options: { readonly ownerId: Evolu.OwnerId },
) => EvoluMutationResult;

export type EvoluCashuOperationUpdate = (
  table: "cashuOperation",
  payload: EvoluCashuOperationUpdatePayload,
  options: { readonly ownerId: Evolu.OwnerId },
) => EvoluMutationResult;

interface EvoluOperationStoreDeps {
  /** Operation rows visible to the wallet, across cashu owner lanes, deduped by id. */
  readonly loadOperationRows: () => ReadonlyArray<CashuOperationRow>;
  readonly update: EvoluCashuOperationUpdate;
  readonly upsert: EvoluCashuOperationUpsert;
  readonly getWriteOwnerId: () => Evolu.OwnerId;
}

const decodeStoredOperation = Schema.decodeUnknownOption(StoredOperation);

/** A stored row in the port's shape; `null` for a row that does not validate. */
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
    locked: row.locked === null ? null : row.locked === Evolu.sqliteTrue,
    expiresAt: row.expiresAtSec,
    createdAt: row.createdAtSec,
    tokenText: row.tokenText,
    error: row.error,
  });
  return decoded._tag === "Some" ? decoded.value : null;
};

// The error column caps at 1000 chars; a longer serialized error is cut.
const toErrorColumn = (
  error: string | null,
): typeof Evolu.NonEmptyString1000.Type | null => {
  const text = (error ?? "").trim().slice(0, 1000);
  return text ? Evolu.NonEmptyString1000.orThrow(text) : null;
};

const reflectsWrite = (
  loaded: StoredOperation,
  written: StoredOperation,
): boolean =>
  loaded.status === written.status &&
  loaded.counter === written.counter &&
  loaded.error === written.error;

const decodeId = Evolu.id("CashuOperation");
const toEvoluId = (id: string): CashuOperationId => {
  const decoded = decodeId.fromUnknown(id);
  if (!decoded.ok) throw new Error("cashuOperation id is not an Evolu id");
  return decoded.value;
};

export const makeEvoluOperationStore = (
  deps: EvoluOperationStoreDeps,
): OperationStoreService => {
  const overlay = makeWriteOverlay<StoredOperation>(reflectsWrite);

  const loaded = (): Array<{ row: StoredOperation; lane: Evolu.OwnerId }> =>
    deps.loadOperationRows().flatMap((row) => {
      const stored = toStoredOperation(row);
      return stored === null ? [] : [{ row: stored, lane: row.ownerId }];
    });

  const toUpdatePayload = (
    id: CashuOperationId,
    patch: OperationPatch,
  ): EvoluCashuOperationUpdatePayload => ({
    id,
    ...(patch.status !== undefined
      ? { status: Evolu.NonEmptyString100.orThrow(patch.status) }
      : {}),
    ...(patch.counter !== undefined
      ? { counter: Evolu.NonNegativeInt.orThrow(patch.counter) }
      : {}),
    ...(patch.error !== undefined ? { error: toErrorColumn(patch.error) } : {}),
  });

  return {
    insert: (operation) =>
      Effect.sync(() => {
        const id = createCashuOperationId(operationKeyOf(operation));
        const existing = loaded().find((entry) => String(entry.row.id) === id);
        const lane = existing?.lane ?? deps.getWriteOwnerId();
        const errorColumn = toErrorColumn(operation.error);
        const result = deps.upsert(
          "cashuOperation",
          {
            id,
            kind: Evolu.NonEmptyString100.orThrow(operation.kind),
            status: Evolu.NonEmptyString100.orThrow(operation.status),
            mint: Evolu.NonEmptyString1000.orThrow(operation.mint),
            unit: Evolu.NonEmptyString100.orThrow(operation.unit),
            ...(operation.keysetId !== null
              ? {
                  keysetId: Evolu.NonEmptyString100.orThrow(operation.keysetId),
                }
              : {}),
            amount: Evolu.PositiveInt.orThrow(operation.amount),
            ...(operation.feeReserve !== null
              ? {
                  feeReserve: Evolu.NonNegativeInt.orThrow(
                    operation.feeReserve,
                  ),
                }
              : {}),
            ...(operation.inputsTotal !== null
              ? {
                  inputsTotal: Evolu.PositiveInt.orThrow(operation.inputsTotal),
                }
              : {}),
            ...(operation.quoteId !== null
              ? { quoteId: Evolu.NonEmptyString1000.orThrow(operation.quoteId) }
              : {}),
            ...(operation.invoice !== null
              ? { invoice: Evolu.NonEmptyString.orThrow(operation.invoice) }
              : {}),
            ...(operation.sourceMint !== null
              ? {
                  sourceMint: Evolu.NonEmptyString1000.orThrow(
                    operation.sourceMint,
                  ),
                }
              : {}),
            ...(operation.counter !== null
              ? { counter: Evolu.NonNegativeInt.orThrow(operation.counter) }
              : {}),
            ...(operation.locked !== null
              ? {
                  locked: operation.locked
                    ? Evolu.sqliteTrue
                    : Evolu.sqliteFalse,
                }
              : {}),
            ...(operation.expiresAt !== null
              ? { expiresAtSec: Evolu.PositiveInt.orThrow(operation.expiresAt) }
              : {}),
            createdAtSec: Evolu.PositiveInt.orThrow(operation.createdAt),
            ...(operation.tokenText !== null
              ? { tokenText: Evolu.NonEmptyString.orThrow(operation.tokenText) }
              : {}),
            ...(errorColumn !== null ? { error: errorColumn } : {}),
          },
          { ownerId: lane },
        );
        if (!result.ok) {
          throw new Error(
            `cashuOperation upsert failed: ${String(result.error)}`,
          );
        }
        const stored = new StoredOperation({
          ...operation,
          id: OperationId.make(id),
        });
        overlay.set(stored, lane);
        return stored;
      }),

    update: (id, patch) =>
      Effect.sync(() => {
        const entry =
          overlay.get(id) ??
          loaded().find((candidate) => candidate.row.id === id);
        if (entry === undefined) return;
        const result = deps.update(
          "cashuOperation",
          toUpdatePayload(toEvoluId(id), patch),
          { ownerId: entry.lane },
        );
        if (!result.ok) {
          throw new Error(
            `cashuOperation update failed: ${String(result.error)}`,
          );
        }
        overlay.set(applyOperationPatch(entry.row, patch), entry.lane);
      }),

    loadAll: Effect.sync(() =>
      overlay.merge(loaded().map((entry) => entry.row)),
    ),
  };
};

export const evoluOperationStore = (
  deps: EvoluOperationStoreDeps,
): Layer.Layer<OperationStore> =>
  Layer.sync(OperationStore, () => makeEvoluOperationStore(deps));
