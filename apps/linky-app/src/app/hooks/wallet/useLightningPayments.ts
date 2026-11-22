import { getLightningInvoicePreview } from "@linky-fit/linkshu";
import { useAtom } from "@linky-fit/linkstr-react";
import React from "react";
import type { Translate } from "../../../i18n";
import { getLnurlPayDisplayText } from "../../../lnurlPay";
import { navigateTo } from "../../../hooks/useRouting";
import type { Route } from "../../../types/route";
import { getUnknownErrorMessage } from "../../../utils/unknown";
import type {
  LightningInvoiceQuote,
  PayInvoiceOptions,
  QuoteLightningInvoiceOutcome,
} from "../../state/wallet/payments";
import type { DisplayAmountParts } from "../../../utils/displayAmounts";
import {
  paidOverlayContact,
  type PaidOverlayDetails,
} from "../../lib/paidOverlay";
import {
  lightningInvoiceQuoteAtom,
  type LightningInvoiceQuoteState,
  pendingLightningInvoiceAtom,
  postPaySaveContactAtom,
} from "../../state/shell/confirmations";
import { useKnownLnAddressPayContact } from "./usePaymentDrafts";
import {
  paymentCopy,
  usePaymentsCommands,
  useRememberLinkySupport,
  type Shortfall,
} from "./paymentUi";

interface UseLightningPaymentsParams {
  dismissPaymentSending: () => void;
  formatDisplayedAmountParts: (amountSat: number) => DisplayAmountParts;
  rememberFirstPayment: () => void;
  reportShortfall: (shortfall: Shortfall) => void;
  routeKind: Route["kind"];
  setStatus: React.Dispatch<React.SetStateAction<string | null>>;
  showPaidOverlay: (title?: string, details?: PaidOverlayDetails) => void;
  showPaymentSending: (details: PaidOverlayDetails) => void;
  t: Translate;
}

const NOT_READY = "Cashu storage is not ready";

/** The quote the confirm dialog showed for `invoice`, if it showed one. */
const confirmedQuote = (
  state: LightningInvoiceQuoteState | null,
  invoice: string,
): LightningInvoiceQuote | undefined =>
  state?.invoice === invoice &&
  state.outcome !== "pending" &&
  state.outcome._tag === "Quoted"
    ? state.outcome
    : undefined;

/**
 * Lightning payments from the cashu balance (linkshu Melt, LNURL for
 * addresses) mapped to overlays, statuses and navigation. A melt the mint
 * has not settled shows as pending; `useMeltRecovery` finishes it.
 */
export const useLightningPayments = ({
  dismissPaymentSending,
  formatDisplayedAmountParts,
  rememberFirstPayment,
  reportShortfall,
  routeKind,
  setStatus,
  showPaidOverlay,
  showPaymentSending,
  t,
}: UseLightningPaymentsParams) => {
  const commands = usePaymentsCommands();
  const rememberLinkySupport = useRememberLinkySupport();
  const [
    pendingLightningInvoiceConfirmation,
    setPendingLightningInvoiceConfirmation,
  ] = useAtom(pendingLightningInvoiceAtom);
  const [postPaySaveContact, setPostPaySaveContact] = useAtom(
    postPaySaveContactAtom,
  );
  const [invoiceQuote, setInvoiceQuote] = useAtom(lightningInvoiceQuoteAtom);
  const [quoteRound, requote] = React.useReducer(
    (round: number) => round + 1,
    0,
  );

  const { knownLnAddressPayContact } = useKnownLnAddressPayContact(routeKind);

  // The fee estimate of the invoice waiting for confirmation; a stale answer is dropped.
  React.useEffect(() => {
    const pending = pendingLightningInvoiceConfirmation;
    if (pending === null || pending.amountSat === null || commands === null) {
      setInvoiceQuote(null);
      return;
    }
    const { invoice } = pending;
    let current = true;
    setInvoiceQuote({ invoice, outcome: "pending" });
    void commands
      .quoteLightningInvoice(invoice)
      .catch(
        (error: unknown): QuoteLightningInvoiceOutcome => ({
          _tag: "Failed",
          detail: getUnknownErrorMessage(error, "quote failed"),
        }),
      )
      .then((outcome) => {
        if (current) setInvoiceQuote({ invoice, outcome });
      });
    return () => {
      current = false;
    };
  }, [
    commands,
    pendingLightningInvoiceConfirmation,
    quoteRound,
    setInvoiceQuote,
  ]);

  const payInvoice = React.useCallback(
    async (invoice: string, options?: PayInvoiceOptions): Promise<boolean> => {
      if (commands === null) {
        setStatus(`${t("errorPrefix")}: ${NOT_READY}`);
        return false;
      }
      // On screen before the wallet is even asked, so the user sees the payment start at once.
      showPaymentSending({
        direction: "out",
        amountSat:
          getLightningInvoicePreview(invoice.trim())?.amountSat ??
          options?.amountSat ??
          null,
      });
      const outcome = await commands.payLightningInvoice(invoice, options);
      dismissPaymentSending();
      switch (outcome._tag) {
        case "Paid": {
          const amount = outcome.receipt.paidAmount;
          showPaidOverlay(
            paymentCopy(t("paidSent"), formatDisplayedAmountParts(amount)),
            { direction: "out", amountSat: amount },
          );
          rememberFirstPayment();
          break;
        }
        case "Pending":
          setStatus(t("payPending"));
          rememberFirstPayment();
          break;
        case "Insufficient":
        case "NeedsMintMove":
          reportShortfall(outcome);
          return false;
        case "Failed":
          setStatus(`${t("payFailed")}: ${outcome.detail}`);
          return false;
        case "NetworkError":
          setStatus(t("payNetworkError"));
          return false;
        case "Busy":
        case "Invalid":
          return false;
      }
      if (routeKind === "manualPay" || routeKind === "lnInvoicePay")
        navigateTo({ route: "wallet" });
      return true;
    },
    [
      commands,
      dismissPaymentSending,
      formatDisplayedAmountParts,
      rememberFirstPayment,
      reportShortfall,
      routeKind,
      setStatus,
      showPaidOverlay,
      showPaymentSending,
      t,
    ],
  );

  /** Pays `invoice`; `amountSat` is what an amountless one is paid with. */
  const payLightningInvoiceWithCashu = React.useCallback(
    (invoice: string, amountSat?: number) =>
      payInvoice(invoice, amountSat === undefined ? undefined : { amountSat }),
    [payInvoice],
  );

  const payLightningAddressWithCashu = React.useCallback(
    async (
      lnAddress: string,
      amountSat: number,
      comment?: string | null,
    ): Promise<void> => {
      if (commands === null) {
        setStatus(`${t("errorPrefix")}: ${NOT_READY}`);
        return;
      }
      const contact = knownLnAddressPayContact;
      showPaymentSending({
        direction: "out",
        amountSat,
        contact: paidOverlayContact(contact),
      });
      const outcome = await commands.payLightningAddress({
        lnAddress,
        amountSat,
        contact,
        comment: comment ?? null,
      });
      dismissPaymentSending();
      switch (outcome._tag) {
        case "Paid": {
          const { receipt, lightningAddress, successAction } = outcome;
          rememberFirstPayment();
          rememberLinkySupport(contact);
          showPaidOverlay(
            paymentCopy(
              t("paidSentTo"),
              formatDisplayedAmountParts(receipt.paidAmount),
              (contact?.name ?? "").trim() ||
                getLnurlPayDisplayText(lnAddress.trim()),
            ),
            {
              direction: "out",
              amountSat: receipt.paidAmount,
              contact: paidOverlayContact(contact),
            },
          );
          if (successAction?.tag === "message") {
            setStatus(
              t("lnurlSuccessActionMessage").replace(
                "{message}",
                successAction.message,
              ),
            );
          } else if (successAction?.tag === "url") {
            setStatus(
              t("lnurlSuccessActionUrl")
                .replace("{description}", successAction.description ?? "")
                .replace("{url}", successAction.url),
            );
          }
          if (lightningAddress && !contact?.id) {
            setPostPaySaveContact({
              lnAddress: lightningAddress,
              amountSat: receipt.paidAmount,
            });
          }
          break;
        }
        case "Pending":
          setStatus(t("payPending"));
          rememberFirstPayment();
          break;
        case "Insufficient":
        case "NeedsMintMove":
          reportShortfall(outcome);
          return;
        case "InvalidAmount":
          setStatus(`${t("errorPrefix")}: ${t("payInvalidAmount")}`);
          return;
        case "Failed":
          setStatus(`${t("payFailed")}: ${outcome.detail}`);
          return;
        case "NetworkError":
          setStatus(t("payNetworkError"));
          return;
        case "Busy":
        case "Invalid":
          return;
      }
      navigateTo({ route: "wallet" });
    },
    [
      commands,
      dismissPaymentSending,
      formatDisplayedAmountParts,
      knownLnAddressPayContact,
      rememberFirstPayment,
      rememberLinkySupport,
      reportShortfall,
      setStatus,
      showPaidOverlay,
      showPaymentSending,
      t,
      setPostPaySaveContact,
    ],
  );

  const closeLightningInvoiceConfirmation = React.useCallback(() => {
    setPendingLightningInvoiceConfirmation(null);
  }, [setPendingLightningInvoiceConfirmation]);

  const confirmLightningInvoicePayment = React.useCallback(async () => {
    const pending = pendingLightningInvoiceConfirmation;
    if (!pending) return;
    const quote = confirmedQuote(invoiceQuote, pending.invoice);
    if (pending.amountSat !== null && !quote) return;
    if (await payInvoice(pending.invoice, { quote }))
      setPendingLightningInvoiceConfirmation(null);
    // A failed attempt may have used up or outlived the quote; the dialog shows a fresh one.
    else if (quote) requote();
  }, [
    invoiceQuote,
    payInvoice,
    pendingLightningInvoiceConfirmation,
    setPendingLightningInvoiceConfirmation,
  ]);

  return {
    closeLightningInvoiceConfirmation,
    confirmLightningInvoicePayment,
    payLightningAddressWithCashu,
    payLightningInvoiceWithCashu,
    pendingLightningInvoiceConfirmation,
    postPaySaveContact,
    setPendingLightningInvoiceConfirmation,
    setPostPaySaveContact,
  };
};
