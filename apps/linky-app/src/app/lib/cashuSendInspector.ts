import { reportInspectorRows } from "../../devtools/inspector/reportInspectorRows";
import { getInspectorEmissionEnabled } from "../../devtools/inspector/inspectorEnabled";

/**
 * App-only fact linkshu cannot see: a `pending` send was closed because its
 * token verifiably reached the recipient (published chat message, POSTed
 * payment request). Without this row the transfer's trail would end on the
 * pending insert.
 */
export const reportCashuSendForgotten = (args: {
  mint: string;
  reason: "message-published" | "payment-request-posted";
  operationId: string;
}): void => {
  if (!getInspectorEmissionEnabled()) return;
  reportInspectorRows([
    {
      at: Date.now(),
      channel: "cashu",
      tag: "send.forgotten",
      summary: `pending send closed — ${args.reason}`,
      links: { operation: args.operationId },
      context: { mint: args.mint },
      payload: args,
    },
  ]);
};
