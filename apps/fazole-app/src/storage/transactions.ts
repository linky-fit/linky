import { TransactionId } from "@linky-fit/domain";
import { Pubkey } from "@linky-fit/linkstr";
import {
  NonEmptyString,
  NonEmptyString100,
  NonEmptyString1000,
  PositiveInt,
  type LinkyDbSchema,
  type Patch,
  type TransactionRecord,
  type TransactionsRepository,
  type TransactionStatus,
  type WriteRow,
} from "@linky-fit/linksync";
import { Effect, Option, Schema } from "effect";
import {
  CzkAmount,
  PaymentMethod,
  Sats,
  VariableSymbol,
  type DirectTransfer,
  type Payment,
  type PaymentStatus,
  type Receipt,
  type Withdrawal,
  type WithdrawalKind,
  type WithdrawalStatus,
} from "../domain";

/**
 * Payments, receipts, direct transfers and withdrawals are Linky
 * `transaction` rows. The row columns carry what Linky's history shows
 * (direction, status, method, sats, fee, mint, note); `detailsJson` carries
 * the fazole fields under `app: "fazole"`.
 */

type TransactionColumns = LinkyDbSchema["transaction"];

const TransactionIdString = Schema.String.pipe(
  Schema.check(Schema.makeFilter((value: string) => TransactionId.is(value))),
);

const BitcoinLegJson = Schema.Struct({
  sats: Sats,
  czkPerBtc: Schema.Finite,
  mintUrl: Schema.String,
  paymentRequest: Schema.String,
  quoteId: Schema.NullOr(Schema.String),
  invoice: Schema.NullOr(Schema.String),
});

const PaymentDetails = Schema.Struct({
  app: Schema.Literal("fazole"),
  kind: Schema.Literal("payment"),
  /** The total charged, the tip included. */
  amountCzk: CzkAmount,
  tipCzk: Schema.optionalKey(CzkAmount),
  vs: VariableSymbol,
  paidAtSec: Schema.optionalKey(Schema.Int),
  bitcoin: Schema.optionalKey(BitcoinLegJson),
  cashuReceive: Schema.optionalKey(
    Schema.Struct({ operationId: Schema.String, sats: Schema.Natural }),
  ),
  payerPubkey: Schema.optionalKey(Pubkey),
  hiddenAtSec: Schema.optionalKey(Schema.Int),
});

const ReceiptDetails = Schema.Struct({
  app: Schema.Literal("fazole"),
  kind: Schema.Literal("receipt"),
  operationId: Schema.String,
  paymentId: Schema.optionalKey(TransactionIdString),
});

const DirectTransferDetails = Schema.Struct({
  app: Schema.Literal("fazole"),
  kind: Schema.Literal("direct"),
  operationId: Schema.String,
  payerPubkey: Pubkey,
  czkPerBtc: Schema.optionalKey(Schema.Finite),
  hiddenAtSec: Schema.optionalKey(Schema.Int),
});

const WithdrawalDetails = Schema.Struct({
  app: Schema.Literal("fazole"),
  kind: Schema.Literal("withdrawal"),
  target: Schema.String,
  quoteId: Schema.optionalKey(Schema.String),
  invoice: Schema.optionalKey(Schema.String),
  operationId: Schema.optionalKey(Schema.String),
});

const Details = Schema.fromJsonString(
  Schema.Union([
    PaymentDetails,
    ReceiptDetails,
    DirectTransferDetails,
    WithdrawalDetails,
  ]),
);
const decodeDetails = Schema.decodeUnknownOption(Details);
const encodeDetails = (details: typeof Details.Type) =>
  NonEmptyString.orThrow(Schema.encodeSync(Details)(details));

const isPaymentMethod = Schema.is(PaymentMethod);

const paymentStatusOf: Record<TransactionStatus, PaymentStatus> = {
  pending: "pending",
  ok: "paid",
  declined: "cancelled",
  error: "cancelled",
};
const rowStatusOfPayment: Record<PaymentStatus, TransactionStatus> = {
  pending: "pending",
  paid: "ok",
  cancelled: "declined",
};
const withdrawalStatusOf: Record<TransactionStatus, WithdrawalStatus> = {
  pending: "pending",
  ok: "done",
  declined: "failed",
  error: "failed",
};
const rowStatusOfWithdrawal: Record<WithdrawalStatus, TransactionStatus> = {
  pending: "pending",
  done: "ok",
  failed: "error",
};

const WITHDRAWAL_KINDS: ReadonlyArray<WithdrawalKind> = [
  "lightning_invoice",
  "lightning_address",
  "cashu_chat",
];
const withdrawalKindOf = (method: string | null): WithdrawalKind | null =>
  WITHDRAWAL_KINDS.find((kind) => kind === method) ?? null;

/** The fazole records stored in Linky's transaction rows; rows of other apps are skipped. */
export interface FazoleRecords {
  /** Newest first. */
  readonly payments: ReadonlyArray<Payment>;
  readonly receipts: ReadonlyArray<Receipt>;
  readonly directTransfers: ReadonlyArray<DirectTransfer>;
  readonly withdrawals: ReadonlyArray<Withdrawal>;
}

export const toFazoleRecords = (
  rows: ReadonlyArray<TransactionRecord>,
): FazoleRecords => {
  const payments: Payment[] = [];
  const receipts: Receipt[] = [];
  const directTransfers: DirectTransfer[] = [];
  const withdrawals: Withdrawal[] = [];
  for (const row of [...rows].sort((a, b) => b.createdAtSec - a.createdAtSec)) {
    const details = decodeDetails(row.detailsJson);
    if (Option.isNone(details)) continue;
    const value = details.value;
    switch (value.kind) {
      case "payment":
        payments.push({
          id: row.id,
          amountCzk: value.amountCzk,
          tipCzk: value.tipCzk ?? null,
          vs: value.vs,
          status: paymentStatusOf[row.status],
          method: isPaymentMethod(row.method) ? row.method : null,
          createdAtSec: row.createdAtSec,
          paidAtSec: value.paidAtSec ?? null,
          bitcoin: value.bitcoin ?? null,
          cashuReceive: value.cashuReceive ?? null,
          payerPubkey: value.payerPubkey ?? null,
          hiddenAtSec: value.hiddenAtSec ?? null,
        });
        break;
      case "receipt":
        if (row.amount !== null) {
          receipts.push({
            id: row.id,
            method: row.method === "lightning" ? "lightning" : "cashu",
            sats: row.amount,
            receivedAtSec: row.createdAtSec,
            operationId: value.operationId,
            paymentId:
              value.paymentId !== undefined && TransactionId.is(value.paymentId)
                ? value.paymentId
                : null,
          });
        }
        break;
      case "direct":
        if (row.amount !== null && row.mint !== null) {
          directTransfers.push({
            id: row.id,
            sats: row.amount,
            czkPerBtc: value.czkPerBtc ?? null,
            receivedAtSec: row.createdAtSec,
            operationId: value.operationId,
            mintUrl: row.mint,
            payerPubkey: value.payerPubkey,
            note: row.note,
            hiddenAtSec: value.hiddenAtSec ?? null,
          });
        }
        break;
      case "withdrawal": {
        const kind = withdrawalKindOf(row.method);
        if (kind !== null && row.amount !== null) {
          withdrawals.push({
            id: row.id,
            kind,
            status: withdrawalStatusOf[row.status],
            target: value.target,
            amountSats: row.amount,
            feeSats: row.fee,
            createdAtSec: row.createdAtSec,
            mintUrl: row.mint ?? "",
            quoteId: value.quoteId ?? null,
            invoice: value.invoice ?? null,
            operationId: value.operationId ?? null,
            error: row.error,
          });
        }
        break;
      }
    }
  }
  return { payments, receipts, directTransfers, withdrawals };
};

export const readFazoleRecords = (
  transactions: TransactionsRepository,
): Effect.Effect<FazoleRecords> =>
  Effect.map(transactions.all, toFazoleRecords);

const positiveOrNull = (value: number | null) =>
  value !== null && value > 0 ? PositiveInt.orThrow(value) : null;

const paymentColumns = (payment: Payment) => ({
  createdAtSec: PositiveInt.orThrow(payment.createdAtSec),
  direction: NonEmptyString100.orThrow("in"),
  status: NonEmptyString100.orThrow(rowStatusOfPayment[payment.status]),
  method:
    payment.method === null ? null : NonEmptyString100.orThrow(payment.method),
  amount: positiveOrNull(payment.bitcoin?.sats ?? null),
  mint:
    payment.bitcoin === null
      ? null
      : NonEmptyString1000.orThrow(payment.bitcoin.mintUrl),
  unit: payment.bitcoin === null ? null : NonEmptyString100.orThrow("sat"),
  detailsJson: encodeDetails({
    app: "fazole",
    kind: "payment",
    amountCzk: payment.amountCzk,
    ...(payment.tipCzk === null ? {} : { tipCzk: payment.tipCzk }),
    vs: payment.vs,
    ...(payment.paidAtSec === null ? {} : { paidAtSec: payment.paidAtSec }),
    ...(payment.bitcoin === null ? {} : { bitcoin: payment.bitcoin }),
    ...(payment.cashuReceive === null
      ? {}
      : { cashuReceive: payment.cashuReceive }),
    ...(payment.payerPubkey === null
      ? {}
      : { payerPubkey: payment.payerPubkey }),
    ...(payment.hiddenAtSec === null
      ? {}
      : { hiddenAtSec: payment.hiddenAtSec }),
  }),
});

const receiptColumns = (receipt: Receipt) => ({
  createdAtSec: PositiveInt.orThrow(receipt.receivedAtSec),
  direction: NonEmptyString100.orThrow("in"),
  status: NonEmptyString100.orThrow("ok"),
  method: NonEmptyString100.orThrow(receipt.method),
  amount: PositiveInt.orThrow(receipt.sats),
  unit: NonEmptyString100.orThrow("sat"),
  detailsJson: encodeDetails({
    app: "fazole",
    kind: "receipt",
    operationId: receipt.operationId,
    ...(receipt.paymentId === null ? {} : { paymentId: receipt.paymentId }),
  }),
});

const directTransferColumns = (transfer: DirectTransfer) => ({
  createdAtSec: PositiveInt.orThrow(transfer.receivedAtSec),
  direction: NonEmptyString100.orThrow("in"),
  status: NonEmptyString100.orThrow("ok"),
  method: NonEmptyString100.orThrow("cashu"),
  amount: PositiveInt.orThrow(transfer.sats),
  mint: NonEmptyString1000.orThrow(transfer.mintUrl),
  unit: NonEmptyString100.orThrow("sat"),
  note:
    transfer.note === null ? null : NonEmptyString1000.orThrow(transfer.note),
  detailsJson: encodeDetails({
    app: "fazole",
    kind: "direct",
    operationId: transfer.operationId,
    payerPubkey: transfer.payerPubkey,
    ...(transfer.czkPerBtc === null ? {} : { czkPerBtc: transfer.czkPerBtc }),
    ...(transfer.hiddenAtSec === null
      ? {}
      : { hiddenAtSec: transfer.hiddenAtSec }),
  }),
});

const withdrawalColumns = (withdrawal: Withdrawal) => ({
  createdAtSec: PositiveInt.orThrow(withdrawal.createdAtSec),
  direction: NonEmptyString100.orThrow("out"),
  status: NonEmptyString100.orThrow(rowStatusOfWithdrawal[withdrawal.status]),
  method: NonEmptyString100.orThrow(withdrawal.kind),
  amount: PositiveInt.orThrow(withdrawal.amountSats),
  fee: positiveOrNull(withdrawal.feeSats),
  mint: NonEmptyString1000.orThrow(withdrawal.mintUrl),
  unit: NonEmptyString100.orThrow("sat"),
  error:
    withdrawal.error === null
      ? null
      : NonEmptyString1000.orThrow(withdrawal.error.slice(0, 1000)),
  detailsJson: encodeDetails({
    app: "fazole",
    kind: "withdrawal",
    target: withdrawal.target,
    ...(withdrawal.quoteId === null ? {} : { quoteId: withdrawal.quoteId }),
    ...(withdrawal.invoice === null ? {} : { invoice: withdrawal.invoice }),
    ...(withdrawal.operationId === null
      ? {}
      : { operationId: withdrawal.operationId }),
  }),
});

/** Evolu inserts omit empty optional columns instead of writing `null`. */
const withoutNulls = <C extends Patch<TransactionColumns>>(
  columns: C,
): Patch<TransactionColumns> =>
  Object.fromEntries(
    Object.entries(columns).filter(([, value]) => value !== null),
  );

const insertRow = (
  id: TransactionId,
  columns: ReturnType<
    | typeof paymentColumns
    | typeof receiptColumns
    | typeof directTransferColumns
    | typeof withdrawalColumns
  >,
) => {
  const { createdAtSec, direction, status } = columns;
  const row: WriteRow<TransactionColumns> = {
    ...withoutNulls(columns),
    id,
    createdAtSec,
    direction,
    status,
  };
  return row;
};

export const insertPayment = (
  transactions: TransactionsRepository,
  payment: Payment,
) => transactions.insert(insertRow(payment.id, paymentColumns(payment)));

/** Writes the payment's current state; a row in an older shard moves to the active one. */
export const updatePayment = (
  transactions: TransactionsRepository,
  payment: Payment,
) => transactions.update(payment.id, paymentColumns(payment));

/** Records a receipt once: its id derives from the receive, so a replay writes nothing. */
export const insertReceipt = (
  transactions: TransactionsRepository,
  receipt: Receipt,
) =>
  transactions.insertIfAbsent(insertRow(receipt.id, receiptColumns(receipt)));

/** Records a direct transfer once: like a receipt's, its id derives from the receive. */
export const insertDirectTransfer = (
  transactions: TransactionsRepository,
  transfer: DirectTransfer,
) =>
  transactions.insertIfAbsent(
    insertRow(transfer.id, directTransferColumns(transfer)),
  );

export const updateDirectTransfer = (
  transactions: TransactionsRepository,
  transfer: DirectTransfer,
) => transactions.update(transfer.id, directTransferColumns(transfer));

export const insertWithdrawal = (
  transactions: TransactionsRepository,
  withdrawal: Withdrawal,
) =>
  transactions.insert(insertRow(withdrawal.id, withdrawalColumns(withdrawal)));

export const updateWithdrawal = (
  transactions: TransactionsRepository,
  withdrawal: Withdrawal,
) => transactions.update(withdrawal.id, withdrawalColumns(withdrawal));
