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

/**
 * One pass of "return unclaimed tokens": the app re-received every issued
 * send nobody claimed, by hand from the tokens page or automatically after
 * the configured wait. linkshu logs each receive on its own; this row ties
 * them together with the reason and the tally.
 */
export const reportCashuUnclaimedReturned = (args: {
  reason: "manual" | "auto";
  olderThanSec: number | null;
  eligible: number;
  returned: number;
  returnedAmount: number;
  claimed: number;
  failed: number;
  mintUnreachable: boolean;
  operationIds: readonly string[];
}): void => {
  if (!getInspectorEmissionEnabled()) return;
  reportInspectorRows([
    {
      at: Date.now(),
      channel: "cashu",
      tag: "send.returnUnclaimed",
      summary: `${args.reason} return of unclaimed sends — ${args.returned} returned (${args.returnedAmount} sat), ${args.claimed} claimed, ${args.failed} failed`,
      links: { operation: [...args.operationIds] },
      payload: args,
    },
  ]);
};
