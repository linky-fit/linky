import { Context, Effect, Schema } from "effect";
import {
  Amount,
  Bolt11Invoice,
  CurrencyUnit,
  KeysetId,
  MintUrl,
  NonNegativeAmount,
  OperationId,
  QuoteId,
  TokenText,
  UnixSeconds,
} from "../domain/primitives";

/**
 * Every durable link between inputs and outputs. Quote kinds (`melt`,
 * `topup`, `autoswap`) are what a resumer finishes after a crash; transfer
 * kinds (`send`, `receive`) remember token text for dedup and for taking a
 * handed-out token back. Inputs are never stored on the operation: they are
 * the proof rows whose `operationId` points here.
 */
export const OperationKind = Schema.Literal(
  "melt",
  "topup",
  "autoswap",
  "send",
  "receive",
);
export type OperationKind = typeof OperationKind.Type;

/**
 * - quote kinds: `pending` → `paid` | `unpaid` | `failed` (melt), `done` |
 *   `failed` (topup, autoswap)
 * - `send`: `issued` | `pending` | `externalized` → `done` (claimed or
 *   delivered) | `returned` (taken back into the wallet)
 * - `receive`: `pending` → `done` | `failed`
 */
export const OperationStatus = Schema.Literal(
  "pending",
  "paid",
  "unpaid",
  "done",
  "failed",
  "issued",
  "externalized",
  "returned",
);
export type OperationStatus = typeof OperationStatus.Type;

const operationFields = {
  kind: OperationKind,
  status: OperationStatus,
  /** The target mint for `autoswap`. */
  mint: MintUrl,
  unit: CurrencyUnit,
  /** Quote kinds: the keyset the deterministic outputs derive from. */
  keysetId: Schema.NullOr(KeysetId),
  amount: Amount,
  /** `melt` only. */
  feeReserve: Schema.NullOr(NonNegativeAmount),
  /** `melt` only: sum of the held inputs. */
  inputsTotal: Schema.NullOr(Amount),
  quoteId: Schema.NullOr(QuoteId),
  invoice: Schema.NullOr(Bolt11Invoice),
  /** `autoswap` only: where the funds were melted out of. */
  sourceMint: Schema.NullOr(MintUrl),
  /**
   * Quote kinds: first deterministic output slot of the latest attempt
   * (mint outputs, or NUT-08 blanks). Synced, so any device re-derives the
   * same blinded outputs on resume.
   */
  counter: Schema.NullOr(Schema.Int.pipe(Schema.nonNegative())),
  /** `topup`: NUT-20 locked quote, minting needs the owner's key. */
  locked: Schema.NullOr(Schema.Boolean),
  /** Mint-stated quote expiry. */
  expiresAt: Schema.NullOr(UnixSeconds),
  /** Event time, set by the package; distinct from storage timestamps. */
  createdAt: UnixSeconds,
  /** Transfer kinds: the original text, kept for dedup and `returnToWallet`. */
  tokenText: Schema.NullOr(TokenText),
  /** Serialized tagged error of the last failure. */
  error: Schema.NullOr(Schema.String),
};

export class StoredOperation extends Schema.Class<StoredOperation>(
  "StoredOperation",
)({
  id: OperationId,
  ...operationFields,
}) {}

export class NewOperation extends Schema.Class<NewOperation>("NewOperation")(
  operationFields,
) {}

export interface OperationPatch {
  readonly status?: OperationStatus;
  readonly counter?: number;
  readonly error?: string | null;
}

/**
 * The natural key an operation id derives from: a transfer is identified by
 * its kind and token text, a quote operation by kind, mint, and quote id.
 * Adapters hash it into their own id format (`deriveStoreId` for stores
 * without one).
 */
export const operationKeyOf = (
  operation: Pick<NewOperation, "kind" | "mint" | "quoteId" | "tokenText">,
): string =>
  operation.tokenText === null
    ? [operation.kind, operation.mint, operation.quoteId ?? ""].join("|")
    : [operation.kind, operation.tokenText].join("|");

export interface OperationStoreService {
  /**
   * Persists the operation and assigns its id, which MUST be a pure
   * function of `operationKeyOf(operation)`. Inserting an existing key is an
   * upsert onto that row (every field replaced).
   */
  readonly insert: (operation: NewOperation) => Effect.Effect<StoredOperation>;
  /** Applies the present fields; unknown id: no-op. */
  readonly update: (
    id: OperationId,
    patch: OperationPatch,
  ) => Effect.Effect<void>;
  readonly loadAll: Effect.Effect<ReadonlyArray<StoredOperation>>;
}

export class OperationStore extends Context.Tag("linkshu/OperationStore")<
  OperationStore,
  OperationStoreService
>() {}
