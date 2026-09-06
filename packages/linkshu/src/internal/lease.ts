import { Data, Effect, Schedule } from "effect";
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
    Effect.retry(Schedule.spaced(pollMs).pipe(Schedule.upTo(acquireTimeoutMs))),
  );

/**
 * Mutual exclusion on a `KeyValueStore` key, built on the port's two lease
 * primitives (retries, timeouts, and release-on-exit are package semantics).
 * The lease is always released — on success, failure, and interrupt.
 */
export const withKeyLease =
  (kv: KeyValueStoreService, key: string, options?: KeyLeaseOptions) =>
  <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E | LeaseLockTimeout, R> =>
    Effect.acquireUseRelease(
      acquireLease(
        kv,
        key,
        options?.ttlMs ?? DEFAULT_TTL_MS,
        options?.acquireTimeoutMs ?? DEFAULT_ACQUIRE_TIMEOUT_MS,
        options?.pollMs ?? DEFAULT_POLL_MS,
      ),
      () => effect,
      (lease) => kv.releaseLease(key, lease),
    );
