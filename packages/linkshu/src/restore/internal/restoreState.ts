import { Effect, Schema } from "effect";
import { KeysetId } from "../../domain/primitives";
import type { CurrencyUnit, MintUrl } from "../../domain/primitives";
import { readStoredInteger, scopeSuffix } from "../../internal/counters";
import type { CounterScope } from "../../internal/counters";
import type { KeyValueStoreService } from "../../ports/KeyValueStore";

/**
 * Restore's own durable bookkeeping, next to the deterministic counters and
 * keyed the same way. Two facts survive between runs:
 *
 * - the cursor, so a second restore resumes near where the last one stopped
 *   instead of rescanning the whole derivation tree, and
 * - the keysets a mint has shown us, so proofs signed by a keyset the mint
 *   later stops listing are still recoverable.
 */

export const RESTORE_CURSOR_KEY_PREFIX = "linkshu.restoreCursor.";
const SEEN_KEYSETS_KEY_PREFIX = "linkshu.seenKeysets.";

export const restoreCursorKey = (scope: CounterScope): string =>
  RESTORE_CURSOR_KEY_PREFIX + scopeSuffix(scope);

/** Absent or malformed cursors read as 0 — scan the tree from its start. */
export const readRestoreCursor = (
  kv: KeyValueStoreService,
  scope: CounterScope,
): Effect.Effect<number> => readStoredInteger(kv, restoreCursorKey(scope), 0);

/** Cursors never move backwards; a lower one would only redo covered ground. */
export const advanceRestoreCursor = (
  kv: KeyValueStoreService,
  scope: CounterScope,
  target: number,
): Effect.Effect<number> =>
  Effect.gen(function* () {
    const current = yield* readRestoreCursor(kv, scope);
    const next = Math.max(current, Math.floor(target));
    if (next > current) yield* kv.set(restoreCursorKey(scope), String(next));
    return next;
  });

const seenKeysetPrefix = (mint: MintUrl, unit: CurrencyUnit): string =>
  SEEN_KEYSETS_KEY_PREFIX +
  [mint, unit].map(encodeURIComponent).join(".") +
  ".";

export const seenKeysetKey = (
  mint: MintUrl,
  unit: CurrencyUnit,
  keysetId: KeysetId,
): string => seenKeysetPrefix(mint, unit) + encodeURIComponent(keysetId);

export const rememberKeysets = (
  kv: KeyValueStoreService,
  mint: MintUrl,
  unit: CurrencyUnit,
  keysetIds: ReadonlyArray<KeysetId>,
): Effect.Effect<void> =>
  Effect.forEach(
    keysetIds,
    (keysetId) => kv.set(seenKeysetKey(mint, unit, keysetId), keysetId),
    { discard: true },
  );

const decodeKeysetId = Schema.decodeUnknownOption(KeysetId);

export const readSeenKeysets = (
  kv: KeyValueStoreService,
  mint: MintUrl,
  unit: CurrencyUnit,
): Effect.Effect<ReadonlyArray<KeysetId>> =>
  Effect.gen(function* () {
    const keysetIds: KeysetId[] = [];
    for (const key of yield* kv.listKeys(seenKeysetPrefix(mint, unit))) {
      const decoded = decodeKeysetId(yield* kv.get(key));
      if (decoded._tag === "Some") keysetIds.push(decoded.value);
    }
    return keysetIds;
  });
