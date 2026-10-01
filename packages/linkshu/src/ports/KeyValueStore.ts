import { Context, Effect, Schema } from "effect";

/** Opaque proof of lease ownership; only its issuer can release the lease. */
export const LeaseId = Schema.Trimmed.pipe(
  Schema.check(Schema.isNonEmpty()),
  Schema.brand("LeaseId"),
);
export type LeaseId = typeof LeaseId.Type;

/**
 * Durable string key-value storage with lease-lock primitives.
 *
 * Plain get/set is not enough: deterministic counters must be advanced under
 * mutual exclusion across every context sharing the storage (browser tabs, a
 * service worker, CLI processes), or two concurrent operations derive the
 * same outputs and collide at the mint. The port stays dumb on purpose — two
 * lease primitives, no policy: acquisition retries, queueing, and timeouts
 * are package semantics built on top, identical on every platform.
 *
 * `tryAcquireLease` atomically claims `key` for `ttlMs` milliseconds and
 * returns a lease id, or `null` when a live lease is already held. Expired
 * leases are claimable. `releaseLease` is a no-op unless the lease is still
 * the live one.
 *
 * Keys are namespaced by the package (`linkshu.` prefix); values never
 * contain seed material.
 */
export interface KeyValueStoreService {
  readonly get: (key: string) => Effect.Effect<string | null>;
  readonly set: (key: string, value: string) => Effect.Effect<void>;
  readonly remove: (key: string) => Effect.Effect<void>;
  /** All stored keys starting with `prefix`; drives seed-bound state wipes. */
  readonly listKeys: (prefix: string) => Effect.Effect<ReadonlyArray<string>>;
  readonly tryAcquireLease: (
    key: string,
    ttlMs: number,
  ) => Effect.Effect<LeaseId | null>;
  readonly releaseLease: (key: string, lease: LeaseId) => Effect.Effect<void>;
}

export class KeyValueStore extends Context.Service<
  KeyValueStore,
  KeyValueStoreService
>()("linkshu/KeyValueStore") {}
