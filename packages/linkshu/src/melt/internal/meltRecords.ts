import { Schema } from "effect";
import {
  Amount,
  Bolt11Invoice,
  CurrencyUnit,
  KeysetId,
  MintUrl,
  NonNegativeAmount,
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
 * Melt's durable bookkeeping: the `melt` operation holding the quote, the
 * invoice, the amounts, and the blank-output slot of the latest attempt. Its
 * inputs are the proofs `held` under its id. The record lands before the
 * melt request leaves, so a payment whose outcome the process never saw —
 * PENDING past the poll budget, a lost response, a crash — is always
 * reconstructible from storage on any device.
 */

/** Only the mint's own answer retires a melt record; time alone never does. */
export const PENDING_MELT_TTL_SECONDS = 24 * 60 * 60;

export class PendingMelt extends Schema.Class<PendingMelt>("PendingMelt")({
  id: OperationId,
  quoteId: QuoteId,
  mint: MintUrl,
  unit: CurrencyUnit,
  keysetId: KeysetId,
  invoice: Bolt11Invoice,
  amount: Amount,
  feeReserve: NonNegativeAmount,
  /** Sum of the melt inputs held under this record. */
  inputsTotal: Amount,
  expiresAt: Schema.NullOr(UnixSeconds),
  createdAt: UnixSeconds,
  /**
   * First deterministic slot of the NUT-08 blank outputs the latest melt
   * attempt sent, or null before any attempt reached the mint.
   */
  counter: Schema.NullOr(Schema.Int),
}) {}

const decodePendingMelt = Schema.decodeUnknownOption(PendingMelt);

/** The record shape releases before the inventory kept in the key-value store. */
const LegacyPendingMelt = Schema.Struct({
  quoteId: QuoteId,
  mint: MintUrl,
  unit: CurrencyUnit,
  keysetId: KeysetId,
  invoice: Bolt11Invoice,
  amount: Amount,
  feeReserve: NonNegativeAmount,
  inputsTotal: Amount,
  expiresAt: Schema.NullOr(UnixSeconds),
  createdAt: UnixSeconds,
  blankCounter: Schema.NullOr(Schema.Int),
});
const decodeLegacy = legacyDecoder(LegacyPendingMelt);

const codec: QuoteRecordCodec<PendingMelt> = {
  kind: "melt",
  toOperation: (draft) =>
    new NewOperation({
      kind: "melt",
      status: "pending",
      mint: draft.mint,
      unit: draft.unit,
      keysetId: draft.keysetId,
      amount: draft.amount,
      feeReserve: draft.feeReserve,
      inputsTotal: draft.inputsTotal,
      quoteId: draft.quoteId,
      invoice: draft.invoice,
      sourceMint: null,
      counter: draft.counter,
      locked: null,
      expiresAt: draft.expiresAt,
      createdAt: draft.createdAt,
      tokenText: null,
      error: null,
    }),
  fromOperation: (operation: StoredOperation) => {
    const decoded = decodePendingMelt({
      id: operation.id,
      quoteId: operation.quoteId,
      mint: operation.mint,
      unit: operation.unit,
      keysetId: operation.keysetId,
      invoice: operation.invoice,
      amount: operation.amount,
      feeReserve: operation.feeReserve,
      inputsTotal: operation.inputsTotal,
      expiresAt: operation.expiresAt,
      createdAt: operation.createdAt,
      counter: operation.counter,
    });
    return decoded._tag === "Some" ? decoded.value : null;
  },
  legacy: {
    prefix: "linkshu.pendingMelt.",
    decode: (raw) => {
      const legacy = decodeLegacy(raw);
      if (legacy === null) return null;
      const { blankCounter, ...rest } = legacy;
      return { ...rest, counter: blankCounter };
    },
  },
};

export const meltRecords = (
  ctx: QuoteRecordContext,
): QuoteRecordStore<PendingMelt> =>
  quoteRecordStore(ctx, codec, PENDING_MELT_TTL_SECONDS);
