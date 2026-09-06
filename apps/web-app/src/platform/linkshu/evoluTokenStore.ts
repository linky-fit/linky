import * as Evolu from "@evolu/common";
import {
  StoredTokenRow,
  TokenRowId,
  TokenStore,
  TokenText,
  UnixSeconds,
} from "@linky/linkshu";
import type { TokenRowPatch, TokenStoreService } from "@linky/linkshu";
import { Effect, Layer, Schema } from "effect";
import {
  createCashuTokenId,
  isDeletedCashuRow,
} from "../../app/lib/cashuTokenIdentity";
import {
  CASHU_TOKEN_STATE_ACCEPTED,
  CASHU_TOKEN_STATE_ERROR,
  normalizeCashuTokenState,
} from "../../app/lib/cashuTokenState";
import type { CashuTokenId, CashuTokenRow } from "../../evolu";
import { nowSeconds } from "../../utils/time";

/**
 * Linkshu's `TokenStore` port over the Evolu `cashuToken` table.
 *
 * Writes go through the sparse-payload convention (deprecated columns such as
 * `rawToken`/`mint`/`unit`/`amount` are never written), new rows get a
 * deterministic id derived from `originalTokenText`, and removal is a soft
 * delete. Mutations target the owner lane the row is stored in — writing
 * through the active lane when the row lives in an older `cashu-n` lane
 * silently no-ops, so writes go to the lane recorded on the row itself.
 *
 * `loadTokenRows` serves the React render state, which lags Evolu mutations
 * by at least one render. Linkshu chains writes and reads within one
 * operation (Receive inserts a pending row, swaps at the mint, then updates
 * that row), so the store keeps a write overlay of its own mutations and
 * serves them until the lagging read model reflects each one — otherwise the
 * post-swap update would miss the just-inserted row and silently no-op.
 */

/**
 * Catch-all tagged shape for pre-linkshu plain-text `error` values, applied
 * at the read boundary; rows written by linkshu carry serialized tagged
 * errors and pass through unchanged.
 */
class LegacyError extends Schema.TaggedError<LegacyError>()("LegacyError", {
  detail: Schema.String,
}) {}

const encodeLegacyError = Schema.encodeSync(Schema.parseJson(LegacyError));
const decodeTokenText = Schema.decodeUnknownOption(TokenText);

type EvoluCashuMutationResult =
  | { readonly ok: true }
  | { readonly error: unknown; readonly ok: false };

interface EvoluCashuTokenInsertPayload {
  readonly error?: typeof Evolu.NonEmptyString1000.Type;
  readonly id: CashuTokenId;
  readonly originalTokenText: typeof Evolu.NonEmptyString.Type;
  readonly state: typeof Evolu.NonEmptyString100.Type;
  readonly token: typeof Evolu.NonEmptyString.Type;
}

interface EvoluCashuTokenUpdatePayload {
  readonly error?: typeof Evolu.NonEmptyString1000.Type | null;
  readonly id: CashuTokenId;
  readonly isDeleted?: typeof Evolu.sqliteTrue;
  readonly state?: typeof Evolu.NonEmptyString100.Type;
  readonly token?: typeof Evolu.NonEmptyString.Type;
}

type EvoluCashuTokenUpsert = (
  table: "cashuToken",
  payload: EvoluCashuTokenInsertPayload,
  options: { readonly ownerId: Evolu.OwnerId },
) => EvoluCashuMutationResult;

type EvoluCashuTokenUpdate = (
  table: "cashuToken",
  payload: EvoluCashuTokenUpdatePayload,
  options: { readonly ownerId: Evolu.OwnerId },
) => EvoluCashuMutationResult;

interface EvoluTokenStoreDeps {
  /** All cashuToken rows visible to the wallet, across cashu owner lanes. */
  readonly loadTokenRows: () => Promise<ReadonlyArray<CashuTokenRow>>;
  readonly update: EvoluCashuTokenUpdate;
  readonly upsert: EvoluCashuTokenUpsert;
  /** Active cashu write lane; new rows are inserted there. */
  readonly getWriteOwnerId: () => Evolu.OwnerId;
}

const parseTokenText = (value: string | null): TokenText | null => {
  if (value === null) return null;
  const decoded = decodeTokenText(value.trim());
  return decoded._tag === "Some" ? decoded.value : null;
};

const isSerializedTaggedError = (text: string): boolean => {
  try {
    const parsed: unknown = JSON.parse(text);
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof Reflect.get(parsed, "_tag") === "string"
    );
  } catch {
    return false;
  }
};

const toPortableErrorText = (error: string | null): string | null => {
  const text = (error ?? "").trim();
  if (!text) return null;
  if (isSerializedTaggedError(text)) return text;
  return encodeLegacyError(new LegacyError({ detail: text }));
};

// The error column caps at 1000 chars; a truncated serialized error is no
// longer valid JSON and re-reads wrapped as LegacyError.
const toErrorColumn = (
  error: string | null,
): typeof Evolu.NonEmptyString1000.Type | null => {
  const text = (error ?? "").trim().slice(0, 1000);
  if (!text) return null;
  return Evolu.NonEmptyString1000.orThrow(text);
};

const toStoredTokenRow = (row: CashuTokenRow): StoredTokenRow | null => {
  const tokenText = parseTokenText(row.token);
  if (tokenText === null) return null;

  const originalTokenText =
    parseTokenText(row.originalTokenText) ??
    parseTokenText(row.rawToken) ??
    tokenText;

  const state =
    normalizeCashuTokenState(row.state) ?? CASHU_TOKEN_STATE_ACCEPTED;

  return new StoredTokenRow({
    createdAt: UnixSeconds.make(Math.floor(Date.parse(row.createdAt) / 1000)),
    error:
      state === CASHU_TOKEN_STATE_ERROR ? toPortableErrorText(row.error) : null,
    id: TokenRowId.make(row.id),
    originalTokenText,
    state,
    tokenText,
  });
};

interface OverlayEntry {
  row: StoredTokenRow;
  readonly evoluId: CashuTokenId;
  readonly lane: Evolu.OwnerId;
  removed: boolean;
}

const applyPatchToStoredRow = (
  row: StoredTokenRow,
  patch: TokenRowPatch,
): StoredTokenRow =>
  new StoredTokenRow({
    ...row,
    ...(patch.tokenText !== undefined ? { tokenText: patch.tokenText } : {}),
    ...(patch.state !== undefined ? { state: patch.state } : {}),
    ...(patch.error !== undefined ? { error: patch.error } : {}),
  });

/** The lagging read model reflects the overlay's last write for this row. */
const reflectsOverlayRow = (
  evoluRow: CashuTokenRow,
  overlayRow: StoredTokenRow,
): boolean => {
  const state =
    normalizeCashuTokenState(evoluRow.state) ?? CASHU_TOKEN_STATE_ACCEPTED;
  return (
    state === overlayRow.state &&
    (evoluRow.token ?? "").trim() === overlayRow.tokenText
  );
};

export const makeEvoluTokenStore = (
  deps: EvoluTokenStoreDeps,
): TokenStoreService => {
  const overlay = new Map<string, OverlayEntry>();

  const loadLiveRows = async (): Promise<CashuTokenRow[]> =>
    (await deps.loadTokenRows()).filter((row) => !isDeletedCashuRow(row));

  const findRow = async (id: TokenRowId): Promise<CashuTokenRow | null> =>
    (await loadLiveRows()).find((row) => String(row.id) === id) ?? null;

  const rowLane = (row: CashuTokenRow): Evolu.OwnerId =>
    row.ownerId ?? deps.getWriteOwnerId();

  const runUpdate = (
    payload: EvoluCashuTokenUpdatePayload,
    ownerId: Evolu.OwnerId,
  ): void => {
    const result = deps.update("cashuToken", payload, { ownerId });
    if (!result.ok) {
      throw new Error(`cashuToken update failed: ${String(result.error)}`);
    }
  };

  const toUpdatePayload = (
    id: CashuTokenId,
    patch: TokenRowPatch,
  ): EvoluCashuTokenUpdatePayload => ({
    id,
    ...(patch.tokenText !== undefined
      ? { token: Evolu.NonEmptyString.orThrow(patch.tokenText) }
      : {}),
    ...(patch.state !== undefined
      ? { state: Evolu.NonEmptyString100.orThrow(patch.state) }
      : {}),
    ...(patch.error !== undefined ? { error: toErrorColumn(patch.error) } : {}),
  });

  return {
    insert: (row) =>
      Effect.sync(() => {
        const id = createCashuTokenId(row.originalTokenText);
        const lane = deps.getWriteOwnerId();
        const errorColumn = toErrorColumn(row.error);
        const result = deps.upsert(
          "cashuToken",
          {
            id,
            originalTokenText: Evolu.NonEmptyString.orThrow(
              row.originalTokenText,
            ),
            state: Evolu.NonEmptyString100.orThrow(row.state),
            token: Evolu.NonEmptyString.orThrow(row.tokenText),
            ...(errorColumn !== null ? { error: errorColumn } : {}),
          },
          { ownerId: lane },
        );
        if (!result.ok) {
          throw new Error(`cashuToken upsert failed: ${String(result.error)}`);
        }
        const stored = new StoredTokenRow({
          createdAt: UnixSeconds.make(nowSeconds()),
          error: row.error,
          id: TokenRowId.make(id),
          originalTokenText: row.originalTokenText,
          state: row.state,
          tokenText: row.tokenText,
        });
        overlay.set(id, {
          row: stored,
          evoluId: id,
          lane,
          removed: false,
        });
        return stored;
      }),

    update: (id, patch) =>
      Effect.promise(async () => {
        const entry = overlay.get(id);
        if (entry !== undefined) {
          if (entry.removed) return;
          runUpdate(toUpdatePayload(entry.evoluId, patch), entry.lane);
          entry.row = applyPatchToStoredRow(entry.row, patch);
          return;
        }
        const target = await findRow(id);
        if (target === null) return;
        const lane = rowLane(target);
        runUpdate(toUpdatePayload(target.id, patch), lane);
        const stored = toStoredTokenRow(target);
        if (stored !== null) {
          overlay.set(id, {
            row: applyPatchToStoredRow(stored, patch),
            evoluId: target.id,
            lane,
            removed: false,
          });
        }
      }),

    remove: (id) =>
      Effect.promise(async () => {
        const entry = overlay.get(id);
        if (entry !== undefined) {
          if (!entry.removed) {
            runUpdate(
              { id: entry.evoluId, isDeleted: Evolu.sqliteTrue },
              entry.lane,
            );
            entry.removed = true;
          }
          return;
        }
        const target = await findRow(id);
        if (target === null) return;
        const lane = rowLane(target);
        runUpdate({ id: target.id, isDeleted: Evolu.sqliteTrue }, lane);
        const stored = toStoredTokenRow(target);
        if (stored !== null) {
          overlay.set(id, {
            row: stored,
            evoluId: target.id,
            lane,
            removed: true,
          });
        }
      }),

    loadAll: Effect.promise(async () => {
      const liveRows = await loadLiveRows();
      const seenIds = new Set<string>();
      const result: StoredTokenRow[] = [];
      for (const row of liveRows) {
        const key = row.id;
        seenIds.add(key);
        const entry = overlay.get(key);
        if (entry !== undefined) {
          if (entry.removed) continue;
          if (reflectsOverlayRow(row, entry.row)) {
            overlay.delete(key);
          } else {
            result.push(entry.row);
            continue;
          }
        }
        const stored = toStoredTokenRow(row);
        if (stored !== null) result.push(stored);
      }
      for (const [key, entry] of overlay) {
        if (seenIds.has(key) || entry.removed) continue;
        result.push(entry.row);
      }
      return result;
    }),
  };
};

export const evoluTokenStore = (
  deps: EvoluTokenStoreDeps,
): Layer.Layer<TokenStore> =>
  Layer.sync(TokenStore, () => makeEvoluTokenStore(deps));
