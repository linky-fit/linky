import { Data, Duration, Effect, Schedule } from "effect";
import type { KeyValueStoreService, LeaseId } from "../ports/KeyValueStore";

/** Internal; the counter vertical maps it to the public `CounterLockTimeout`. */
export class LeaseLockTimeout extends Data.TaggedError("LeaseLockTimeout")<{
  readonly key: string;
}> {}

export interface KeyLeaseOptions {
  readonly ttlMs?: number;
  readonly acquireTimeoutMs?: number;
  readonly pollMs?: number;
}

const DEFAULT_TTL_MS = 15_000;
const DEFAULT_ACQUIRE_TIMEOUT_MS = 15_000;
const DEFAULT_POLL_MS = 50;

const acquireLease = (
  kv: KeyValueStoreService,
  key: string,
  ttlMs: number,
  acquireTimeoutMs: number,
  pollMs: number,
): Effect.Effect<LeaseId, LeaseLockTimeout> =>
  Effect.flatMap(kv.tryAcquireLease(key, ttlMs), (lease) =>
    lease === null ? new LeaseLockTimeout({ key }) : Effect.succeed(lease),
  ).pipe(
    Effect.retry(
      Schedule.spaced(pollMs).pipe(
        Schedule.upTo({ duration: acquireTimeoutMs }),
      ),
    ),
  );

const keepRenewed = (
  kv: KeyValueStoreService,
  key: string,
  lease: LeaseId,
  ttlMs: number,
): Effect.Effect<never> =>
  kv
    .renewLease(key, lease, ttlMs)
    .pipe(Effect.delay(Duration.millis(ttlMs / 3)), Effect.forever);

/**
 * Mutual exclusion on a `KeyValueStore` key, built on the port's lease
 * primitives (retries, timeouts, renewal, and release-on-exit are package
 * semantics). The lease is renewed every third of its TTL while `effect`
 * runs, so it never lapses under a running holder however long the holder
 * takes, and outlives a holder that died by at most the TTL. It is always
 * released — on success, failure, and interrupt.
 */
export const withKeyLease =
  (kv: KeyValueStoreService, key: string, options?: KeyLeaseOptions) =>
  <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E | LeaseLockTimeout, R> => {
    const ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;
    return Effect.acquireUseRelease(
      acquireLease(
        kv,
        key,
        ttlMs,
        options?.acquireTimeoutMs ?? DEFAULT_ACQUIRE_TIMEOUT_MS,
        options?.pollMs ?? DEFAULT_POLL_MS,
      ),
      (lease) => Effect.raceFirst(effect, keepRenewed(kv, key, lease, ttlMs)),
      (lease) => kv.releaseLease(key, lease),
    );
  };
