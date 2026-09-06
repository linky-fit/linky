import { Clock, Effect, Layer } from "effect";
import { TokenRowId, UnixSeconds } from "../domain/primitives";
import { StoredTokenRow, TokenStore } from "../ports/TokenStore";
import type { TokenStoreService } from "../ports/TokenStore";

/**
 * In-memory store with the observable semantics of stores that derive row
 * ids from `originalTokenText` (the web app's Evolu adapter): inserting the
 * same original text upserts — overwriting, and reviving a removed row —
 * onto the same id, removal is a soft delete, and updates to a removed row
 * are ignored. Exists so package tests exercise flows against id collisions
 * a unique-id store can never produce.
 */
const makeDeterministicIdTokenStore = (): TokenStoreService => {
  const idByText = new Map<string, TokenRowId>();
  const idFor = (originalTokenText: string): TokenRowId => {
    const key = originalTokenText.trim();
    const existing = idByText.get(key);
    if (existing !== undefined) return existing;
    const id = TokenRowId.make(`det-${idByText.size + 1}`);
    idByText.set(key, id);
    return id;
  };

  const entries = new Map<
    TokenRowId,
    { row: StoredTokenRow; removed: boolean }
  >();

  return {
    insert: (row) =>
      Effect.map(Clock.currentTimeMillis, (millis) => {
        const stored = new StoredTokenRow({
          id: idFor(row.originalTokenText),
          originalTokenText: row.originalTokenText,
          tokenText: row.tokenText,
          state: row.state,
          error: row.error,
          createdAt: UnixSeconds.make(Math.floor(millis / 1000)),
        });
        entries.set(stored.id, { row: stored, removed: false });
        return stored;
      }),
    update: (id, patch) =>
      Effect.sync(() => {
        const entry = entries.get(id);
        if (entry === undefined || entry.removed) return;
        entry.row = new StoredTokenRow({
          ...entry.row,
          ...(patch.tokenText !== undefined
            ? { tokenText: patch.tokenText }
            : {}),
          ...(patch.state !== undefined ? { state: patch.state } : {}),
          ...(patch.error !== undefined ? { error: patch.error } : {}),
        });
      }),
    remove: (id) =>
      Effect.sync(() => {
        const entry = entries.get(id);
        if (entry !== undefined) entry.removed = true;
      }),
    loadAll: Effect.sync(() =>
      [...entries.values()]
        .filter((entry) => !entry.removed)
        .map((entry) => entry.row),
    ),
  };
};

/** Non-durable, single-process; for tests only. */
export const deterministicIdTokenStore: Layer.Layer<TokenStore> = Layer.sync(
  TokenStore,
  makeDeterministicIdTokenStore,
);
