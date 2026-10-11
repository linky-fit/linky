import {
  getLightningInvoicePreview,
  type LightningInvoicePreview,
} from "@linky-fit/linkshu";
import React from "react";
import type { Translate } from "../../../i18n";
import { getLnurlPayDisplayText } from "../../../lnurlPay";
import { navigateTo } from "../../../hooks/useRouting";
import type { Route } from "../../../types/route";
import type { DisplayAmountParts } from "../../../utils/displayAmounts";
import { normalizeNpubIdentifier } from "../../../utils/nostrNpub";
import {
  paidOverlayContact,
  type PaidOverlayDetails,
} from "../../lib/paidOverlay";
import type { ContactRowLike } from "../../types/appTypes";
import type { ContactId } from "../../../evolu";
import { paymentCopy, usePaymentsCommands, type Shortfall } from "./paymentUi";

interface UseLightningPaymentsParams {
  contacts: readonly ContactRowLike[];
  dismissPaymentSending: () => void;
  formatDisplayedAmountParts: (amountSat: number) => DisplayAmountParts;
  lnAddressPayContactId: ContactId | null;
  nostrPictureByNpub: Record<string, string | null>;
  rememberFirstPayment: () => void;
  reportShortfall: (shortfall: Shortfall) => void;
  routeKind: Route["kind"];
  setStatus: React.Dispatch<React.SetStateAction<string | null>>;
  showPaidOverlay: (title?: string, details?: PaidOverlayDetails) => void;
  showPaymentSending: (details: PaidOverlayDetails) => void;
  t: Translate;
}

const NOT_READY = "Cashu storage is not ready";

/**
 * Lightning payments from the cashu balance (linkshu Melt, LNURL for
 * addresses) mapped to overlays, statuses and navigation. A melt the mint
 * has not settled shows as pending; `useMeltRecovery` finishes it.
 */
export const useLightningPayments = ({
  contacts,
  dismissPaymentSending,
  formatDisplayedAmountParts,
  lnAddressPayContactId,
  nostrPictureByNpub,
  rememberFirstPayment,
  reportShortfall,
  routeKind,
  setStatus,
  showPaidOverlay,
  showPaymentSending,
  t,
}: UseLightningPaymentsParams) => {
  const commands = usePaymentsCommands();
  const [
    pendingLightningInvoiceConfirmation,
    setPendingLightningInvoiceConfirmation,
  ] = React.useState<LightningInvoicePreview | null>(null);
  const [postPaySaveContact, setPostPaySaveContact] = React.useState<null | {
    lnAddress: string;
    amountSat: number;
  }>(null);

  // Only a contact the user chose to pay; a lightning address never identifies one.
  const knownLnAddressPayContact = React.useMemo(
    () =>
      routeKind === "lnAddressPay" && lnAddressPayContactId
        ? (contacts.find((contact) => contact.id === lnAddressPayContactId) ??
          null)
        : null,
    [contacts, lnAddressPayContactId, routeKind],
  );
  const knownLnAddressPayContactPictureUrl = React.useMemo(() => {
    const npub = normalizeNpubIdentifier(knownLnAddressPayContact?.npub ?? "");
    return npub ? (nostrPictureByNpub[npub] ?? null) : null;
  }, [knownLnAddressPayContact, nostrPictureByNpub]);

  const payLightningInvoiceWithCashu = React.useCallback(
    async (invoice: string): Promise<boolean> => {
      if (commands === null) {
        setStatus(`${t("errorPrefix")}: ${NOT_READY}`);
        return false;
      }
      const outcome = await commands.payLightningInvoice(invoice, {
        onSending: () =>
          showPaymentSending({
            direction: "out",
            amountSat:
              getLightningInvoicePreview(invoice.trim())?.amountSat ?? null,
          }),
      });
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
        case "Busy":
        case "Invalid":
          return false;
      }
      if (routeKind === "manualPay") navigateTo({ route: "wallet" });
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
      const outcome = await commands.payLightningAddress(
        { lnAddress, amountSat, contact, comment: comment ?? null },
        {
          onSending: () =>
            showPaymentSending({
              direction: "out",
              amountSat,
              contact: paidOverlayContact(contact),
            }),
        },
      );
      dismissPaymentSending();
      switch (outcome._tag) {
        case "Paid": {
          const { receipt, lightningAddress, successAction } = outcome;
          rememberFirstPayment();
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
      reportShortfall,
      setStatus,
      showPaidOverlay,
      showPaymentSending,
      t,
    ],
  );

  const closeLightningInvoiceConfirmation = React.useCallback(() => {
    setPendingLightningInvoiceConfirmation(null);
  }, []);

  const confirmLightningInvoicePayment = React.useCallback(async () => {
    const pending = pendingLightningInvoiceConfirmation;
    if (!pending) return;
    if (await payLightningInvoiceWithCashu(pending.invoice))
      setPendingLightningInvoiceConfirmation(null);
  }, [payLightningInvoiceWithCashu, pendingLightningInvoiceConfirmation]);

  return {
    closeLightningInvoiceConfirmation,
    confirmLightningInvoicePayment,
    knownLnAddressPayContact,
    knownLnAddressPayContactPictureUrl,
    payLightningAddressWithCashu,
    payLightningInvoiceWithCashu,
    pendingLightningInvoiceConfirmation,
    postPaySaveContact,
    setPendingLightningInvoiceConfirmation,
    setPostPaySaveContact,
  };
};
