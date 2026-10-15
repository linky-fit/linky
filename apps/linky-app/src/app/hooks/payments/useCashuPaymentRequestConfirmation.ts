import { useAtom } from "@linky-fit/linkstr-react";
import { useCallback } from "react";
import type { CashuPaymentRequestMessageInfo } from "../../lib/paymentRequestMessage";
import {
  pendingCashuPaymentRequestAtom,
  type PendingCashuPaymentRequest,
} from "../../state/shell/confirmations";
import type {
  PaymentRequestQuote,
  QuotePaymentRequestOutcome,
} from "../../state/wallet/payments";

export type ReviewedCashuPaymentRequest = PendingCashuPaymentRequest & {
  readonly quote: PaymentRequestQuote;
};

export type UnpayableQuote = Exclude<
  QuotePaymentRequestOutcome,
  PaymentRequestQuote
>;

/**
 * Whether the user reviews a request before it is paid. A tap on a chat
 * request's Pay is the approval itself, so only a scan is held to the
 * auto-pay limit, over everything that leaves the wallet.
 */
export const needsPaymentRequestConfirmation = ({
  autoPayLimit,
  explicitTap,
  quote,
  recipientDiffers,
}: {
  readonly autoPayLimit: number;
  readonly explicitTap: boolean;
  readonly quote: PaymentRequestQuote | null;
  readonly recipientDiffers: boolean;
}): boolean =>
  quote === null ||
  recipientDiffers ||
  (quote._tag === "Lightning" && quote.addsMint) ||
  (!explicitTap && quote.amount + quote.fee > autoPayLimit);

const isQuote = (
  outcome: QuotePaymentRequestOutcome,
): outcome is PaymentRequestQuote =>
  outcome._tag === "Direct" || outcome._tag === "Lightning";

interface UseCashuPaymentRequestConfirmationParams {
  autoPayLimit: number;
  cashuIsBusy: boolean;
  pay: (reviewed: ReviewedCashuPaymentRequest) => Promise<void>;
  /** Null while the wallet is not ready. */
  quote: (
    request: CashuPaymentRequestMessageInfo,
    amountSat: number,
  ) => Promise<QuotePaymentRequestOutcome | null>;
  /** Tells the user why a request cannot be paid as quoted. */
  reportUnpayable: (outcome: UnpayableQuote) => void;
}

/** Prices a payment request, then pays it or holds it for the user to review. */
export const useCashuPaymentRequestConfirmation = ({
  autoPayLimit,
  cashuIsBusy,
  pay,
  quote,
  reportUnpayable,
}: UseCashuPaymentRequestConfirmationParams) => {
  const [pending, setPending] = useAtom(pendingCashuPaymentRequestAtom);

  const reviewCashuPaymentRequest = useCallback(
    async (
      draft: Pick<
        PendingCashuPaymentRequest,
        "chat" | "recipientDiffers" | "request"
      > & { readonly explicitTap: boolean },
    ) => {
      if (cashuIsBusy) return;
      const { explicitTap, ...base } = draft;
      const amount = base.request.amount;
      if (amount === null) {
        setPending({ ...base, quote: null, insufficientAmount: null });
        return;
      }
      const outcome = await quote(base.request, amount);
      if (outcome === null) return;
      if (!isQuote(outcome)) {
        reportUnpayable(outcome);
        return;
      }
      const reviewed = { ...base, quote: outcome, insufficientAmount: null };
      if (
        needsPaymentRequestConfirmation({
          autoPayLimit,
          explicitTap,
          quote: outcome,
          recipientDiffers: base.recipientDiffers,
        })
      ) {
        setPending(reviewed);
        return;
      }
      await pay(reviewed);
    },
    [autoPayLimit, cashuIsBusy, pay, quote, reportUnpayable, setPending],
  );

  /** Prices the amount the user entered for an amountless request. */
  const enterCashuPaymentRequestAmount = useCallback(
    async (amountSat: number) => {
      if (!pending || pending.quote !== null || cashuIsBusy) return;
      const outcome = await quote(pending.request, amountSat);
      if (outcome === null) return;
      if (isQuote(outcome)) {
        setPending({ ...pending, quote: outcome, insufficientAmount: null });
        return;
      }
      if (outcome._tag === "Insufficient") {
        setPending({ ...pending, insufficientAmount: amountSat });
        return;
      }
      setPending(null);
      reportUnpayable(outcome);
    },
    [cashuIsBusy, pending, quote, reportUnpayable, setPending],
  );

  const closeCashuPaymentRequestConfirmation = useCallback(() => {
    if (cashuIsBusy) return;
    setPending(null);
  }, [cashuIsBusy, setPending]);

  const confirmCashuPaymentRequest = useCallback(async () => {
    if (!pending || pending.quote === null || cashuIsBusy) return;
    const { quote: reviewedQuote } = pending;
    setPending(null);
    await pay({ ...pending, quote: reviewedQuote });
  }, [cashuIsBusy, pay, pending, setPending]);

  return {
    closeCashuPaymentRequestConfirmation,
    confirmCashuPaymentRequest,
    enterCashuPaymentRequestAmount,
    pendingCashuPaymentRequestConfirmation: pending,
    reviewCashuPaymentRequest,
  };
};
