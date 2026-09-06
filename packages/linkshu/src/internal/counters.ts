import { Effect } from "effect";
import { CounterLockTimeout } from "../domain/errors";
import { DeterministicCounter } from "../domain/primitives";
import type { CurrencyUnit, KeysetId, MintUrl } from "../domain/primitives";
import { CounterAdvanced } from "../inspector/events";
import type { InspectorService } from "../inspector/Inspector";
import type { KeyValueStoreService } from "../ports/KeyValueStore";
import { withKeyLease } from "./lease";
import type { KeyLeaseOptions } from "./lease";

/** One deterministic derivation tree (NUT-13): per mint, unit, and keyset. */
export interface CounterScope {
  readonly mint: MintUrl;
  readonly unit: CurrencyUnit;
  readonly keysetId: KeysetId;
}

export const DETERMINISTIC_COUNTER_KEY_PREFIX = "linkshu.detCounter.";
export const COUNTER_LOCK_KEY_PREFIX = "linkshu.detCounterLock.";

/** Key suffix identifying one derivation tree; shared with restore cursors. */
export const scopeSuffix = (scope: CounterScope): string =>
  [scope.mint, scope.unit, scope.keysetId].map(encodeURIComponent).join(".");

export const deterministicCounterKey = (scope: CounterScope): string =>
  DETERMINISTIC_COUNTER_KEY_PREFIX + scopeSuffix(scope);

/**
 * Cross-context mutual exclusion over one counter scope. Every read and
 * advance of a deterministic counter must happen inside it, or two contexts
 * derive the same outputs and collide at the mint.
 */
export const withCounterLock =
  (kv: KeyValueStoreService, scope: CounterScope, options?: KeyLeaseOptions) =>
  <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E | CounterLockTimeout, R> =>
    withKeyLease(
      kv,
      COUNTER_LOCK_KEY_PREFIX + scopeSuffix(scope),
      options,
    )(effect).pipe(
      Effect.catchTag(
        "LeaseLockTimeout",
        () =>
          new CounterLockTimeout({
            mint: scope.mint,
            unit: scope.unit,
            keysetId: scope.keysetId,
          }),
      ),
    );

/** Stored integer at `key`; absent, malformed, or below `floor` reads as `floor`. */
export const readStoredInteger = (
  kv: KeyValueStoreService,
  key: string,
  floor: number,
): Effect.Effect<number> =>
  Effect.map(kv.get(key), (raw) => {
    const value = Number(raw ?? Number.NaN);
    return Number.isFinite(value) && value > floor ? Math.floor(value) : floor;
  });

/**
 * Stored counter of the scope; absent or malformed values read as 1. Slot 0
 * is never used: cashu-ts treats a deterministic counter of 0 as "auto-assign
 * from the wallet's internal counter source", so only counters >= 1 are
 * honored as the explicit derivation slots this module tracks.
 */
export const readCounter = (
  kv: KeyValueStoreService,
  scope: CounterScope,
): Effect.Effect<number> =>
  readStoredInteger(kv, deterministicCounterKey(scope), 1);

/**
 * Advances the stored counter to `target`, never backwards (a gap costs a
 * restore scan, a reuse costs a mint rejection loop). Caller must hold the
 * counter lock. Returns the counter now in effect.
 */
export const advanceCounterTo = (
  kv: KeyValueStoreService,
  inspector: InspectorService,
  scope: CounterScope,
  target: number,
  reason: "used" | "collision-recovery" | "restore",
): Effect.Effect<number> =>
  Effect.gen(function* () {
    const current = yield* readCounter(kv, scope);
    const next = Math.max(current, Math.floor(target));
    if (next > current) {
      yield* kv.set(deterministicCounterKey(scope), String(next));
      inspector.emit(
        () =>
          new CounterAdvanced(
            {
              mint: scope.mint,
              unit: scope.unit,
              keysetId: scope.keysetId,
              from: DeterministicCounter.make(current),
              to: DeterministicCounter.make(next),
              reason,
            },
            { disableValidation: true },
          ),
      );
    }
    return next;
  });
