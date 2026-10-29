import React from "react";
import type { ContactId } from "../../../evolu";
import type { Translate } from "../../../i18n";
import { navigateTo, type useRouting } from "../../../hooks/useRouting";
import type { DisplayAmountParts } from "../../../utils/displayAmounts";
import {
  paidOverlayContact,
  type PaidOverlayDetails,
} from "../../lib/paidOverlay";
import type { ContactPayment } from "../../state/wallet/payments";
import type { ContactRowLike, LocalNostrMessage } from "../../types/appTypes";
import type { useContactsMessagingComposition } from "../composition/useContactsMessagingComposition";
import type { useBankPaymentOffers } from "../useBankPaymentOffers";

type BankPaymentOffers = ReturnType<typeof useBankPaymentOffers>;
import { paymentCopy, usePaymentsCommands, type Shortfall } from "./paymentUi";

/** Resolves true once the token is made and handed to the outbox. */
type PayContactWithCashuMessage = (args: ContactPayment) => Promise<boolean>;

interface UseContactPaymentsParams {
  cashuBalance: number;
  contactPayMethod: "cashu" | "lightning" | null;
  contacts: readonly ContactRowLike[];
  dismissPaymentSending: () => void;
  formatDisplayedAmountParts: (amountSat: number) => DisplayAmountParts;
  getBankPaymentOfferForSettlement: BankPaymentOffers["getBankPaymentOfferForSettlement"];
  isBankPaymentOfferCanceled: BankPaymentOffers["isBankPaymentOfferCanceled"];
  payAmount: string;
  pushToast: (message: string) => void;
  rememberFirstPayment: () => void;
  reportShortfall: (shortfall: Shortfall) => void;
  respondToBankPaymentOfferWithGroupState: BankPaymentOffers["respondToBankPaymentOfferWithGroupState"];
  route: ReturnType<typeof useRouting>;
  selectedContact: ReturnType<
    typeof useContactsMessagingComposition
  >["selectedContact"];
  setLnAddressPay: (pay: {
    amount: string;
    note: string;
    contactId: ContactId;
  }) => void;
  setStatus: React.Dispatch<React.SetStateAction<string | null>>;
  showPaidOverlay: (title?: string, details?: PaidOverlayDetails) => void;
  showPaymentSending: (details: PaidOverlayDetails) => void;
  t: Translate;
  walletOpRunning: boolean;
}

/**
 * Contact payments over messages (linkshu Send, the token as a chat
 * message) mapped to statuses, overlays and navigation.
 */
export const useContactPayments = ({
  cashuBalance,
  contactPayMethod,
  contacts,
  dismissPaymentSending,
  formatDisplayedAmountParts,
  getBankPaymentOfferForSettlement,
  isBankPaymentOfferCanceled,
  payAmount,
  pushToast,
  rememberFirstPayment,
  reportShortfall,
  respondToBankPaymentOfferWithGroupState,
  route,
  selectedContact,
  setLnAddressPay,
  setStatus,
  showPaidOverlay,
  showPaymentSending,
  t,
  walletOpRunning,
}: UseContactPaymentsParams) => {
  const commands = usePaymentsCommands();

  const payContactWithCashuMessage =
    React.useCallback<PayContactWithCashuMessage>(
      async (args) => {
        if (commands === null) {
          setStatus(`${t("errorPrefix")}: Cashu storage is not ready`);
          return false;
        }
        const { amountSat, contact } = args;
        const displayName =
          (contact.name ?? "").trim() ||
          (contact.lnAddress ?? "").trim() ||
          t("appTitle");
        const overlayContact = paidOverlayContact(contact);
        // On screen before the wallet is even asked, so the user sees the payment start at once.
        showPaymentSending({
          direction: "out",
          amountSat,
          contact: overlayContact,
        });
        const outcome = await commands.payContact(args);
        dismissPaymentSending();
        switch (outcome._tag) {
          case "Sent":
            for (const error of outcome.publishErrors)
              pushToast(`${t("payFailed")}: ${error}`);
            showPaidOverlay(
              paymentCopy(
                outcome.queued ? t("paidQueuedTo") : t("paidSentTo"),
                formatDisplayedAmountParts(outcome.receipt.amount),
                displayName,
              ),
              {
                direction: "out",
                amountSat: outcome.receipt.amount,
                contact: overlayContact,
              },
            );
            rememberFirstPayment();
            navigateTo({ id: outcome.contactId, route: "chat" });
            return true;
          case "AuthorizationChanged":
            setStatus(t("payApprovalChanged"));
            return false;
          case "MissingIdentity":
            setStatus(t("profileMissingNpub"));
            return false;
          case "MissingContactNpub":
            setStatus(t("chatMissingContactNpub"));
            return false;
          case "InvalidContact":
            setStatus(t("payFailed"));
            return false;
          case "Insufficient":
            setStatus(t("payInsufficient"));
            return false;
          case "NetworkError":
            setStatus(t("payNetworkError"));
            return false;
          case "Failed":
            setStatus(
              outcome.insufficient
                ? t("payInsufficient")
                : `${t("payFailed")}: ${outcome.detail}`,
            );
            return false;
          case "Busy":
            return false;
        }
      },
      [
        commands,
        dismissPaymentSending,
        formatDisplayedAmountParts,
        pushToast,
        rememberFirstPayment,
        setStatus,
        showPaidOverlay,
        showPaymentSending,
        t,
      ],
    );

  /** False when no single mint covers it; the shortfall is reported then. */
  const ensureFunds = React.useCallback(
    async (amountSat: number): Promise<boolean> => {
      if (commands === null) return true;
      const funds = await commands.fundsFor(amountSat);
      if (funds._tag === "Covered") return true;
      reportShortfall(funds);
      return false;
    },
    [commands, reportShortfall],
  );

  const paySelectedContact = React.useCallback(
    async (options?: { note?: string | null }) => {
      if (walletOpRunning) return;
      if (route.kind !== "contactPay") return;
      if (!selectedContact) return;

      const note = (options?.note ?? "").trim() || null;
      const amountSat = Number.parseInt(payAmount.trim(), 10);
      if (!Number.isFinite(amountSat) || amountSat <= 0) {
        setStatus(t("payInvalidAmount"));
        return;
      }
      if (amountSat > cashuBalance && !(await ensureFunds(amountSat))) return;

      if (contactPayMethod === "lightning") {
        const lnAddress = (selectedContact.lnAddress ?? "").trim();
        const contactId = selectedContact.id;
        if (!lnAddress || !contactId) {
          setStatus(t("payMissingLn"));
          return;
        }
        setLnAddressPay({
          amount: String(amountSat),
          note: note ?? "",
          contactId,
        });
        navigateTo({ route: "lnAddressPay", lnAddress });
        return;
      }

      await payContactWithCashuMessage({
        contact: selectedContact,
        amountSat,
        memo: note,
      });
    },
    [
      cashuBalance,
      contactPayMethod,
      ensureFunds,
      payAmount,
      payContactWithCashuMessage,
      route.kind,
      selectedContact,
      setLnAddressPay,
      setStatus,
      t,
      walletOpRunning,
    ],
  );

  const settleBankPaymentOffer = React.useCallback(
    async (message: LocalNostrMessage) => {
      if (walletOpRunning) return;
      const offer = getBankPaymentOfferForSettlement(message);
      if (!offer) {
        setStatus(t("spdPaymentOfferFailed"));
        return;
      }
      if (isBankPaymentOfferCanceled(offer.offerId)) {
        setStatus(t("bankPaymentOfferStatusCanceled"));
        return;
      }
      if (!offer.amountSat) {
        setStatus(t("payInvalidAmount"));
        return;
      }
      const contactId = message.contactId.trim();
      const contact =
        contacts.find(
          (candidate) => (candidate.id ?? "").trim() === contactId,
        ) ?? null;
      if (!contact) {
        setStatus(t("contactNotFound"));
        return;
      }

      const sent = await payContactWithCashuMessage({
        contact,
        amountSat: offer.amountSat,
        logCompletedOnly: true,
        paymentNoticeContext: "bank_payment_offer",
        paymentNoticeOfferId: offer.offerId,
      });
      if (sent)
        await respondToBankPaymentOfferWithGroupState(message, "settled");
    },
    [
      contacts,
      getBankPaymentOfferForSettlement,
      isBankPaymentOfferCanceled,
      payContactWithCashuMessage,
      respondToBankPaymentOfferWithGroupState,
      setStatus,
      t,
      walletOpRunning,
    ],
  );

  return {
    payContactWithCashuMessage,
    paySelectedContact,
    settleBankPaymentOffer,
  };
};
