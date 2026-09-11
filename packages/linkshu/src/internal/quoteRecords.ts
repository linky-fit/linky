import { Effect, Option, Schema } from "effect";
import type {
  MintUrl,
  OperationId,
  QuoteId,
  UnixSeconds,
} from "../domain/primitives";
import type { InspectorService } from "../inspector/Inspector";
import type { KeyValueStoreService } from "../ports/KeyValueStore";
import { NewOperation } from "../ports/OperationStore";
import type {
  OperationKind,
  OperationStatus,
  OperationStoreService,
  StoredOperation,
} from "../ports/OperationStore";
import { insertOperation, patchOperation } from "./operations";

/**
 * Durable bookkeeping for a quote a flow must be able to finish after a
 * crash: a typed view over the `pending` operations of one kind. The flows
 * own what a record holds; this module owns how records map onto stored
 * operations, how long one may wait for the mint before it is retired, and
 * how records written by the pre-inventory releases into the key-value
 * store are carried over.
 */

/** What every durable quote record carries; flows add their own fields. */
export interface QuoteRecord {
  readonly id: OperationId;
  readonly mint: MintUrl;
  readonly quoteId: QuoteId;
  readonly createdAt: UnixSeconds;
  /** Mint-stated quote expiry; null when the mint sets none. */
  readonly expiresAt: UnixSeconds | null;
  /** First deterministic output slot of the latest attempt; null before one. */
  readonly counter: number | null;
}

export interface QuoteRecordCodec<R extends QuoteRecord> {
  readonly kind: OperationKind;
  readonly toOperation: (draft: Omit<R, "id">) => NewOperation;
  readonly fromOperation: (operation: StoredOperation) => R | null;
  /** Records the previous storage model kept in the key-value store. */
  readonly legacy: {
    readonly prefix: string;
    readonly decode: (raw: string) => Omit<R, "id"> | null;
  };
}

export interface QuoteRecordStore<R extends QuoteRecord> {
  readonly kind: OperationKind;
  readonly create: (draft: Omit<R, "id">) => Effect.Effect<R>;
  /** Re-points the record at the slot the latest attempt reserved. */
  readonly withCounter: (record: R, counter: number) => Effect.Effect<R>;
  /** A final outcome; the record leaves `readAll`. */
  readonly settle: (
    record: R,
    status: OperationStatus,
    error?: string,
  ) => Effect.Effect<void>;
  readonly read: (mint: MintUrl, quoteId: QuoteId) => Effect.Effect<R | null>;
  /** Every pending record, after carrying over legacy key-value records. */
  readonly readAll: Effect.Effect<ReadonlyArray<R>>;
  /** The mint-stated expiry, else `createdAt` plus the store's ttl. */
  readonly deadlineOf: (record: R) => number;
}

export interface QuoteRecordContext {
  readonly kv: KeyValueStoreService;
  readonly operationStore: OperationStoreService;
  readonly inspector: InspectorService;
}

export const quoteRecordStore = <R extends QuoteRecord>(
  ctx: QuoteRecordContext,
  codec: QuoteRecordCodec<R>,
  ttlSeconds: number,
): QuoteRecordStore<R> => {
  const decodeStored = (operation: StoredOperation): R | null =>
    operation.kind === codec.kind && operation.status === "pending"
      ? codec.fromOperation(operation)
      : null;

  const findOperation = (
    record: R,
  ): Effect.Effect<StoredOperation | undefined> =>
    Effect.map(ctx.operationStore.loadAll, (operations) =>
      operations.find((operation) => operation.id === record.id),
    );

  const create = (draft: Omit<R, "id">): Effect.Effect<R> =>
    Effect.flatMap(
      insertOperation(ctx, codec.toOperation(draft), `${codec.kind}-record`),
      (stored) => {
        const record = codec.fromOperation(stored);
        return record === null
          ? Effect.die(new Error(`stored ${codec.kind} record does not decode`))
          : Effect.succeed(record);
      },
    );

  /** Legacy key-value records become operations once, then their keys go. */
  const carryOverLegacy: Effect.Effect<void> = Effect.gen(function* () {
    const keys = yield* ctx.kv.listKeys(codec.legacy.prefix);
    for (const key of keys) {
      const raw = yield* ctx.kv.get(key);
      const draft = raw === null ? null : codec.legacy.decode(raw);
      if (draft !== null) yield* create(draft);
      yield* ctx.kv.remove(key);
    }
  });

  return {
    kind: codec.kind,
    create,
    withCounter: (record, counter) =>
      Effect.gen(function* () {
        const operation = yield* findOperation(record);
        if (operation !== undefined) {
          yield* patchOperation(ctx, operation, { counter }, "attempt");
        }
        return { ...record, counter };
      }),
    settle: (record, status, error) =>
      Effect.flatMap(findOperation(record), (operation) =>
        operation === undefined
          ? Effect.void
          : patchOperation(
              ctx,
              operation,
              { status, error: error ?? null },
              `${codec.kind}-${status}`,
            ),
      ),
    read: (mint, quoteId) =>
      Effect.map(ctx.operationStore.loadAll, (operations) => {
        for (const operation of operations) {
          const record = decodeStored(operation);
          if (
            record !== null &&
            record.mint === mint &&
            record.quoteId === quoteId
          )
            return record;
        }
        return null;
      }),
    readAll: Effect.gen(function* () {
      yield* carryOverLegacy;
      return (yield* ctx.operationStore.loadAll).flatMap((operation) => {
        const record = decodeStored(operation);
        return record === null ? [] : [record];
      });
    }),
    deadlineOf: (record) => record.expiresAt ?? record.createdAt + ttlSeconds,
  };
};

/** Decodes a legacy key-value record; anything that does not parse is dropped. */
export const legacyDecoder =
  <A, I>(schema: Schema.Schema<A, I, never>) =>
  (raw: string): A | null =>
    Option.getOrNull(Schema.decodeUnknownOption(Schema.parseJson(schema))(raw));
