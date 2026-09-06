import { Effect, Option, Schema } from "effect";
import type { MintUrl, QuoteId, UnixSeconds } from "../domain/primitives";
import type { KeyValueStoreService } from "../ports/KeyValueStore";

/**
 * Durable bookkeeping for a quote a flow must be able to finish after a
 * crash, kept next to the deterministic counters and keyed the same way. The
 * flows own what a record holds; this module owns how records are stored and
 * how long one may wait for the mint before it is retired.
 */

/** What every durable quote record carries; flows add their own fields. */
export interface PendingRecord {
  readonly mint: MintUrl;
  readonly quoteId: QuoteId;
  readonly createdAt: UnixSeconds;
  /** Mint-stated quote expiry; absent or null when the mint sets none. */
  readonly expiresAt?: UnixSeconds | null;
}

export interface PendingRecordStore<R extends PendingRecord> {
  readonly prefix: string;
  readonly key: (mint: MintUrl, quoteId: QuoteId) => string;
  readonly write: (kv: KeyValueStoreService, record: R) => Effect.Effect<void>;
  readonly remove: (kv: KeyValueStoreService, record: R) => Effect.Effect<void>;
  readonly read: (
    kv: KeyValueStoreService,
    mint: MintUrl,
    quoteId: QuoteId,
  ) => Effect.Effect<R | null>;
  /** Every stored record; entries that no longer decode are dropped. */
  readonly readAll: (
    kv: KeyValueStoreService,
  ) => Effect.Effect<ReadonlyArray<R>>;
  /** The mint-stated expiry, else `createdAt` plus the store's ttl. */
  readonly deadlineOf: (record: R) => number;
}

export const pendingRecordStore = <R extends PendingRecord, I>(
  prefix: string,
  schema: Schema.Schema<R, I, never>,
  ttlSeconds: number,
): PendingRecordStore<R> => {
  const encode = Schema.encodeSync(Schema.parseJson(schema));
  const decode = Schema.decodeUnknownOption(Schema.parseJson(schema));
  const key = (mint: MintUrl, quoteId: QuoteId): string =>
    prefix + [mint, quoteId].map(encodeURIComponent).join(".");
  return {
    prefix,
    key,
    write: (kv, record) =>
      kv.set(key(record.mint, record.quoteId), encode(record)),
    remove: (kv, record) => kv.remove(key(record.mint, record.quoteId)),
    read: (kv, mint, quoteId) =>
      Effect.map(kv.get(key(mint, quoteId)), (raw) =>
        Option.getOrNull(decode(raw)),
      ),
    readAll: (kv) =>
      Effect.gen(function* () {
        const keys = yield* kv.listKeys(prefix);
        const values = yield* Effect.forEach(keys, kv.get);
        return values.flatMap((value) => Option.toArray(decode(value)));
      }),
    deadlineOf: (record) => record.expiresAt ?? record.createdAt + ttlSeconds,
  };
};
