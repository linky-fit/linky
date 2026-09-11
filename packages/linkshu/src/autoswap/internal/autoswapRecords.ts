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
 * Autoswap's durable bookkeeping: the same claim-relevant fields as topup's
 * (`ClaimableQuote`) plus where the funds came from. The `autoswap`
 * operation is written before the melt that pays the target mint quote's
 * invoice, so a crash anywhere after the payment leaves a record that names
 * the quote to mint and the counter slots an attempt already burned.
 */

/**
 * Past it, a record the mint answers about but never lets progress — still
 * UNPAID (the melt never happened) or rejecting the claim — is retired. A
 * mint that gives no answer at all never retires a record.
 */
export const PENDING_AUTOSWAP_CLAIM_TTL_SECONDS = 24 * 60 * 60;

export class PendingAutoswapClaim extends Schema.Class<PendingAutoswapClaim>(
  "PendingAutoswapClaim",
)({
  id: OperationId,
  /** Mint quote at the target mint — what the claim mints against. */
  quoteId: QuoteId,
  /** The target (preferred) mint; `ClaimableQuote` names this field `mint`. */
  mint: MintUrl,
  unit: CurrencyUnit,
  keysetId: KeysetId,
  amount: Amount,
  invoice: Bolt11Invoice,
  /** Mint the funds were melted out of; diagnostics only. */
  sourceMint: MintUrl,
  expiresAt: Schema.NullOr(UnixSeconds),
  createdAt: UnixSeconds,
  /** First deterministic slot reserved for the mint attempt; null before one. */
  counter: Schema.NullOr(Schema.Int),
}) {}

const decodePendingClaim = Schema.decodeUnknownOption(PendingAutoswapClaim);

const LegacyPendingClaim = Schema.Struct({
  quoteId: QuoteId,
  mint: MintUrl,
  unit: CurrencyUnit,
  keysetId: KeysetId,
  amount: Amount,
  invoice: Bolt11Invoice,
  sourceMint: MintUrl,
  createdAt: UnixSeconds,
  mintCounter: Schema.NullOr(Schema.Int),
});
const decodeLegacy = legacyDecoder(LegacyPendingClaim);

const codec: QuoteRecordCodec<PendingAutoswapClaim> = {
  kind: "autoswap",
  toOperation: (draft) =>
    new NewOperation({
      kind: "autoswap",
      status: "pending",
      mint: draft.mint,
      unit: draft.unit,
      keysetId: draft.keysetId,
      amount: draft.amount,
      feeReserve: null,
      inputsTotal: null,
      quoteId: draft.quoteId,
      invoice: draft.invoice,
      sourceMint: draft.sourceMint,
      counter: draft.counter,
      locked: null,
      expiresAt: draft.expiresAt,
      createdAt: draft.createdAt,
      tokenText: null,
      error: null,
    }),
  fromOperation: (operation: StoredOperation) => {
    const decoded = decodePendingClaim({
      id: operation.id,
      quoteId: operation.quoteId,
      mint: operation.mint,
      unit: operation.unit,
      keysetId: operation.keysetId,
      amount: operation.amount,
      invoice: operation.invoice,
      sourceMint: operation.sourceMint,
      expiresAt: operation.expiresAt,
      createdAt: operation.createdAt,
      counter: operation.counter,
    });
    return decoded._tag === "Some" ? decoded.value : null;
  },
  legacy: {
    prefix: "linkshu.pendingAutoswapClaim.",
    decode: (raw) => {
      const legacy = decodeLegacy(raw);
      if (legacy === null) return null;
      const { mintCounter, ...rest } = legacy;
      return { ...rest, expiresAt: null, counter: mintCounter };
    },
  },
};

export const autoswapRecords = (
  ctx: QuoteRecordContext,
): QuoteRecordStore<PendingAutoswapClaim> =>
  quoteRecordStore(ctx, codec, PENDING_AUTOSWAP_CLAIM_TTL_SECONDS);
