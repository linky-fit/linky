import { getInspectorEmissionEnabled } from "../../devtools/inspector/inspectorEnabled";
import { reportInspectorRows } from "../../devtools/inspector/reportInspectorRows";
import type { PaymentRequestId } from "@linky-fit/linkshu/payment-request";

const requestLinks = (requestId: PaymentRequestId | null) =>
  requestId === null ? {} : { paymentRequest: requestId };

/** How the wallet chose to pay a NUT-18 request, priced before anything moves. */
export const reportPaymentRequestPlanned = (args: {
  readonly requestId: PaymentRequestId | null;
  readonly amount: number;
  readonly plan: string;
  readonly fee: number | null;
  readonly mint: string | null;
  readonly sourceMint: string | null;
  readonly addsMint: boolean;
  readonly acceptedMints: ReadonlyArray<string>;
}): void => {
  if (!getInspectorEmissionEnabled()) return;
  reportInspectorRows([
    {
      at: Date.now(),
      channel: "app.log",
      tag: "paymentRequest.planned",
      summary: `pay ${args.amount} sat request: ${args.plan}`,
      links: requestLinks(args.requestId),
      ...(args.mint === null ? {} : { context: { mint: args.mint } }),
      payload: args,
    },
  ]);
};

/** The Lightning move that funds a request at one of its mints. */
export const reportPaymentRequestLightningMove = (args: {
  readonly requestId: PaymentRequestId | null;
  readonly sourceMint: string;
  readonly targetMint: string;
  readonly moveAmount: number;
  readonly outcome: "moved" | "failed";
  readonly operationId: string | null;
  readonly feePaid: number | null;
  readonly detail: string | null;
}): void => {
  if (!getInspectorEmissionEnabled()) return;
  reportInspectorRows([
    {
      at: Date.now(),
      channel: "cashu",
      tag: "paymentRequest.lightningMove",
      summary: `request move ${args.moveAmount} sat ${args.outcome}`,
      links: {
        ...requestLinks(args.requestId),
        ...(args.operationId === null ? {} : { operation: args.operationId }),
      },
      context: { mint: args.targetMint },
      payload: args,
    },
  ]);
};

/** The NUT-18 payload leaving over the request's transport; never the proofs. */
export const reportPaymentRequestDelivery = (args: {
  readonly requestId: PaymentRequestId | null;
  readonly transport: "nostr" | "post";
  readonly outcome: "delivered" | "queued" | "failed";
  readonly operationId: string;
  readonly amount: number;
  readonly mint: string;
  readonly detail: string | null;
}): void => {
  if (!getInspectorEmissionEnabled()) return;
  reportInspectorRows([
    {
      at: Date.now(),
      channel: "app.log",
      tag: "paymentRequest.delivery",
      summary: `request payload over ${args.transport} ${args.outcome}`,
      links: {
        ...requestLinks(args.requestId),
        operation: args.operationId,
      },
      context: { mint: args.mint },
      payload: args,
    },
  ]);
};
