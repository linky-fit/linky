import { reportInspectorRows } from "../../devtools/inspector/reportInspectorRows";
import { getInspectorEmissionEnabled } from "../../devtools/inspector/inspectorEnabled";

/**
 * App-only fact linkshu cannot see: a `pending` send row was dropped because
 * its token verifiably reached the recipient (published chat message, POSTed
 * payment request). Without this row the token's lifecycle trail would end on
 * the pending insert.
 */
export const reportCashuSendRowForgotten = (args: {
  mint: string;
  reason: "message-published" | "payment-request-posted";
  rowId: string;
}): void => {
  if (!getInspectorEmissionEnabled()) return;
  reportInspectorRows([
    {
      at: Date.now(),
      channel: "cashu",
      tag: "send.rowForgotten",
      summary: `pending send row dropped — ${args.reason}`,
      links: { row: args.rowId },
      context: { mint: args.mint },
      payload: args,
    },
  ]);
};
