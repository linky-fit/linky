import { Effect, Schema } from "effect";
import { UnixSeconds } from "../../domain/primitives";
import type { MintUrl } from "../../domain/primitives";
import type { KeyValueStoreService } from "../../ports/KeyValueStore";
import { LightningFeeProbeResult } from "../domain";

/**
 * Probing costs a mint quote and a melt quote at two mints, and a mint's
 * Lightning fee moves on a scale of days — so a result is cached per probed
 * mint and served until it ages out.
 */

export const FEE_PROBE_CACHE_KEY_PREFIX = "linkshu.feeProbe.";
export const FEE_PROBE_CACHE_TTL_SECONDS = 24 * 60 * 60;

class CachedFeeProbe extends Schema.Class<CachedFeeProbe>("CachedFeeProbe")({
  result: LightningFeeProbeResult,
  at: UnixSeconds,
}) {}

const encodeCached = Schema.encodeSync(Schema.fromJsonString(CachedFeeProbe));
const decodeCached = Schema.decodeUnknownOption(
  Schema.fromJsonString(CachedFeeProbe),
);

export const feeProbeCacheKey = (mint: MintUrl): string =>
  FEE_PROBE_CACHE_KEY_PREFIX + encodeURIComponent(mint);

/** The stored result while it is still fresh; null once it has aged out. */
export const readCachedFeeProbe = (
  kv: KeyValueStoreService,
  mint: MintUrl,
  now: number,
): Effect.Effect<LightningFeeProbeResult | null> =>
  Effect.map(kv.get(feeProbeCacheKey(mint)), (raw) => {
    const decoded = decodeCached(raw);
    if (decoded._tag === "None") return null;
    const fresh = now - decoded.value.at < FEE_PROBE_CACHE_TTL_SECONDS;
    return fresh ? decoded.value.result : null;
  });

export const writeCachedFeeProbe = (
  kv: KeyValueStoreService,
  result: LightningFeeProbeResult,
  now: number,
): Effect.Effect<void> =>
  kv.set(
    feeProbeCacheKey(result.mint),
    encodeCached(new CachedFeeProbe({ result, at: UnixSeconds.make(now) })),
  );
