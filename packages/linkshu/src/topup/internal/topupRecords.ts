import { Schema } from "effect";
import {
  Amount,
  Bolt11Invoice,
  CurrencyUnit,
  KeysetId,
  MintUrl,
  OperationId,
  QuoteId,
  UnixSeconds,
} from "../../domain/primitives";
import { legacyDecoder, quoteRecordStore } from "../../internal/quoteRecords";
import type {
  QuoteRecordCodec,
  QuoteRecordContext,
  QuoteRecordStore,
} from "../../internal/quoteRecords";
import { NewOperation } from "../../ports/OperationStore";
import type { StoredOperation } from "../../ports/OperationStore";

/**
 * Topup's durable bookkeeping: the `topup` operation is written before every
 * network call that could strand funds, so an interrupted topup is always
 * reconstructible from storage alone — the quote to poll, and the counter
 * slots a mint attempt has already burned.
 */

/**
 * Poll deadline for quotes without a mint-stated expiry: past it the poll
 * ends at the next mint-confirmed UNPAID answer instead of running forever.
 */
export const PENDING_TOPUP_TTL_SECONDS = 24 * 60 * 60;

export class PendingTopup extends Schema.Class<PendingTopup>("PendingTopup")({
  id: OperationId,
  quoteId: QuoteId,
  mint: MintUrl,
  unit: CurrencyUnit,
  keysetId: KeysetId,
  amount: Amount,
  invoice: Bolt11Invoice,
  expiresAt: Schema.NullOr(UnixSeconds),
  createdAt: UnixSeconds,
  /**
   * First deterministic slot reserved for this quote's mint attempt, or null
   * before any attempt. Persisted before the outputs are derived, so a
   * resumed attempt re-derives exactly the same blinded messages instead of
   * burning a second block.
   */
  counter: Schema.NullOr(Schema.Int),
  /** NUT-20 locked quote: minting needs the owner's key. */
  locked: Schema.Boolean,
}) {}

const decodePendingTopup = Schema.decodeUnknownOption(PendingTopup);

const LegacyPendingTopup = Schema.Struct({
  quoteId: QuoteId,
  mint: MintUrl,
  unit: CurrencyUnit,
  keysetId: KeysetId,
  amount: Amount,
  invoice: Bolt11Invoice,
  expiresAt: Schema.NullOr(UnixSeconds),
  createdAt: UnixSeconds,
  mintCounter: Schema.NullOr(Schema.Int),
  locked: Schema.optionalWith(Schema.Boolean, { default: () => false }),
});
const decodeLegacy = legacyDecoder(LegacyPendingTopup);

const codec: QuoteRecordCodec<PendingTopup> = {
  kind: "topup",
  toOperation: (draft) =>
    new NewOperation({
      kind: "topup",
      status: "pending",
      mint: draft.mint,
      unit: draft.unit,
      keysetId: draft.keysetId,
      amount: draft.amount,
      feeReserve: null,
      inputsTotal: null,
      quoteId: draft.quoteId,
      invoice: draft.invoice,
      sourceMint: null,
      counter: draft.counter,
      locked: draft.locked,
      expiresAt: draft.expiresAt,
      createdAt: draft.createdAt,
      tokenText: null,
      error: null,
    }),
  fromOperation: (operation: StoredOperation) => {
    const decoded = decodePendingTopup({
      id: operation.id,
      quoteId: operation.quoteId,
      mint: operation.mint,
      unit: operation.unit,
      keysetId: operation.keysetId,
      amount: operation.amount,
      invoice: operation.invoice,
      expiresAt: operation.expiresAt,
      createdAt: operation.createdAt,
      counter: operation.counter,
      locked: operation.locked ?? false,
    });
    return decoded._tag === "Some" ? decoded.value : null;
  },
  legacy: {
    prefix: "linkshu.pendingTopup.",
    decode: (raw) => {
      const legacy = decodeLegacy(raw);
      if (legacy === null) return null;
      const { mintCounter, ...rest } = legacy;
      return { ...rest, counter: mintCounter };
    },
  },
};

export const topupRecords = (
  ctx: QuoteRecordContext,
): QuoteRecordStore<PendingTopup> =>
  quoteRecordStore(ctx, codec, PENDING_TOPUP_TTL_SECONDS);
