import { PaymentFailed, type MeltResumeResult } from "@linky/linkshu";
import { Option, Schema } from "effect";
import { getInspectorEmissionEnabled } from "../../devtools/inspector/inspectorEnabled";
import { reportInspectorRows } from "../../devtools/inspector/reportInspectorRows";
import { describeTaggedCashuError } from "./cashuStoredError";

/**
 * A Lightning payment linkshu could not settle is logged as a `pending`
 * transaction whose details carry the melt quote id. When
 * `Melt.resumePending` settles the record, these helpers turn the result
 * into the row update and the inspector fact that closes the loop.
 */

export interface MeltTransactionPatch {
  readonly status: "error" | "ok";
  readonly amount?: number;
  readonly fee?: number;
  readonly error?: string;
}

const decodeMeltDetails = Schema.decodeUnknownOption(
  Schema.parseJson(
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
    const failure = new PaymentFailed({
      mint: result.mint,
      quoteId: result.quoteId,
      detail: null,
    });
    return {
      status: "error",
      error: describeTaggedCashuError(failure) ?? failure._tag,
    };
  }
  return null;
};

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
