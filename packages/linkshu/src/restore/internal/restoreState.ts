import { Effect, Schema } from "effect";
import { KeysetId } from "../../domain/primitives";
import type { CurrencyUnit, MintUrl } from "../../domain/primitives";
import type { KeyValueStoreService } from "../../ports/KeyValueStore";

/**
 * Restore's own durable bookkeeping: the keysets a mint has shown us, so
 * proofs signed by a keyset the mint later stops listing are still
 * recoverable. The restore cursor lives with the deterministic counters in
 * `internal/counters.ts`, keyed the same way, because collision recovery
 * reads it too.
 */

const SEEN_KEYSETS_KEY_PREFIX = "linkshu.seenKeysets.";

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
