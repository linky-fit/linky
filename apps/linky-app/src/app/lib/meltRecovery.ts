import {
  PaymentFailed,
  type MeltResumeResult,
  type MintUrl,
  type OperationId,
  type QuoteId,
  type StoredOperation,
} from "@linky-fit/linkshu";
import {
  transactionIdForOperation,
  type TransactionPatch,
  type TransactionRecord,
} from "@linky-fit/linksync";
import { Option, Schema } from "effect";
import { getInspectorEmissionEnabled } from "../../devtools/inspector/inspectorEnabled";
import { reportInspectorRows } from "../../devtools/inspector/reportInspectorRows";
import { describeTaggedCashuError } from "./cashuStoredError";

/**
 * A Lightning payment linkshu could not settle is logged as a `pending`
 * transaction whose details carry the melt quote id. When the melt settles,
 * here or on another device, these helpers turn it into the row update and
 * the inspector fact that closes the loop.
 */

/** The column patch for the pending transaction: `status` is `ok` or `error`. */
export interface MeltTransactionPatch extends TransactionPatch {
  readonly status: "ok" | "error";
}

const decodeMeltDetails = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({ meltQuoteId: Schema.optional(Schema.String) }),
  ),
);

export const readMeltQuoteIdFromDetailsJson = (
  detailsJson: string | null,
): string | null => {
  if (detailsJson === null) return null;
  const decoded = decodeMeltDetails(detailsJson);
  const quoteId = Option.isSome(decoded) ? decoded.value.meltQuoteId : null;
  return quoteId ? quoteId : null;
};

const failedPatch = (mint: MintUrl, quoteId: QuoteId): MeltTransactionPatch => {
  const failure = new PaymentFailed({ mint, quoteId, detail: null });
  return {
    status: "error",
    error: describeTaggedCashuError(failure) ?? failure._tag,
  };
};

/** The history update a settled resume result implies; null while unsettled. */
export const meltTransactionPatch = (
  result: MeltResumeResult,
): MeltTransactionPatch | null => {
  if (result.status === "paid" && result.receipt !== null) {
    return {
      status: "ok",
      amount: result.receipt.paidAmount,
      ...(result.receipt.feePaid > 0 ? { fee: result.receipt.feePaid } : {}),
    };
  }
  if (result.status === "unpaid") {
    return failedPatch(result.mint, result.quoteId);
  }
  return null;
};

/** A settled melt and the update its pending transaction gets. */
export interface SettledMelt {
  readonly operationId: OperationId;
  readonly mint: MintUrl;
  readonly quoteId: QuoteId;
  readonly patch: MeltTransactionPatch;
}

export const settledMeltOfResult = (
  result: MeltResumeResult,
): SettledMelt | null => {
  const patch = meltTransactionPatch(result);
  const { operationId, mint, quoteId } = result;
  return patch === null ? null : { operationId, mint, quoteId, patch };
};

/**
 * A melt operation already closed, here or on another device. It knows no
 * fee: the receipt that does went to whoever settled it.
 */
export const settledMeltOfOperation = (
  operation: StoredOperation,
): SettledMelt | null => {
  const { kind, status, mint, quoteId } = operation;
  if (kind !== "melt" || status === "pending" || quoteId === null) return null;
  return {
    operationId: operation.id,
    mint,
    quoteId,
    patch:
      status === "paid"
        ? { status: "ok", amount: operation.amount }
        : failedPatch(mint, quoteId),
  };
};

export const isPendingTransactionOf = (
  row: TransactionRecord,
  melt: Omit<SettledMelt, "patch">,
): boolean =>
  row.status === "pending" &&
  (row.id === transactionIdForOperation(melt.operationId) ||
    (row.mint === melt.mint &&
      readMeltQuoteIdFromDetailsJson(row.detailsJson) === melt.quoteId));

export const reportMeltHistoryResolved = (args: {
  quoteId: string;
  status: MeltTransactionPatch["status"];
  transactionId: string;
}): void => {
  if (!getInspectorEmissionEnabled()) return;
  reportInspectorRows([
    {
      at: Date.now(),
      channel: "cashu",
      tag: "melt.historyResolved",
      summary: `pending payment history entry → ${args.status}`,
      links: { quote: args.quoteId, transaction: args.transactionId },
      payload: args,
    },
  ]);
};
