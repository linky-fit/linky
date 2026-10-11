import React from "react";
import type { ContactId } from "../../../evolu";
import type { Translate } from "../../../i18n";
import { navigateTo, type useRouting } from "../../../hooks/useRouting";
import type { DisplayAmountParts } from "../../../utils/displayAmounts";
import {
  paidOverlayContact,
  type PaidOverlayDetails,
} from "../../lib/paidOverlay";
import {
  paymentResultOf,
  type ChatWrites,
  type ContactPayment,
} from "../../state/wallet/payments";
import type { ContactRowLike, LocalNostrMessage } from "../../types/appTypes";
import type { CashuMessagePaymentHookResult } from "../payments/cashuMessagePaymentTypes";
import type { useContactsMessagingComposition } from "../composition/useContactsMessagingComposition";
import type { useBankPaymentOffers } from "../useBankPaymentOffers";
import { usePaymentsDomain } from "../usePaymentsDomain";

type BankPaymentOffers = ReturnType<typeof useBankPaymentOffers>;
import { paymentCopy, usePaymentsCommands, type Shortfall } from "./paymentUi";

export type PayContactArgs = Omit<ContactPayment, "offlineNotice">;

export type PayContactWithCashuMessage = (
  args: PayContactArgs,
) => Promise<CashuMessagePaymentHookResult>;

interface UseContactPaymentsParams {
  cashuBalance: number;
  chat: ChatWrites;
  contactPayMethod: "cashu" | "lightning" | null;
  contacts: readonly ContactRowLike[];
  currentNpub: string | null;
  currentNsec: string | null;
  dismissPaymentSending: () => void;
  formatDisplayedAmountParts: (amountSat: number) => DisplayAmountParts;
  getBankPaymentOfferForSettlement: BankPaymentOffers["getBankPaymentOfferForSettlement"];
  isBankPaymentOfferCanceled: BankPaymentOffers["isBankPaymentOfferCanceled"];
  payAmount: string;
  pendingPaymentsKey: string | null;
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

const NOT_READY: CashuMessagePaymentHookResult = {
  error: "cashu storage not ready",
  ok: false,
  queued: false,
  retryable: true,
};

/**
 * Contact payments over messages (linkshu Send, the token as a chat
 * message) mapped to statuses, overlays and navigation; a payment retried
 * from the offline queue shows nothing but a changed approval.
 */
export const useContactPayments = ({
  cashuBalance,
  chat,
  contactPayMethod,
  contacts,
  currentNpub,
  currentNsec,
  dismissPaymentSending,
  formatDisplayedAmountParts,
  getBankPaymentOfferForSettlement,
  isBankPaymentOfferCanceled,
  payAmount,
  pendingPaymentsKey,
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
        const notify = !args.fromQueue;
        if (commands === null) {
          if (notify)
            setStatus(`${t("errorPrefix")}: Cashu storage is not ready`);
          return NOT_READY;
        }
        const { amountSat, contact } = args;
        const displayName =
          (contact.name ?? "").trim() ||
          (contact.lnAddress ?? "").trim() ||
          t("appTitle");
        const overlayContact = paidOverlayContact(contact);
        const outcome = await commands.payContact(
          {
            ...args,
            offlineNotice: paymentCopy(
              t("payQueuedMessage"),
              formatDisplayedAmountParts(amountSat),
              displayName,
            ),
          },
          chat,
          notify
            ? {
                onSending: () =>
                  showPaymentSending({
                    direction: "out",
                    amountSat,
                    contact: overlayContact,
                  }),
              }
            : {},
        );
        if (notify) dismissPaymentSending();
        const showPaid = (template: string, paidAmount: number) => {
          showPaidOverlay(
            paymentCopy(
              template,
              formatDisplayedAmountParts(paidAmount),
              displayName,
            ),
            {
              direction: "out",
              amountSat: paidAmount,
              contact: overlayContact,
            },
          );
          rememberFirstPayment();
        };
        switch (outcome._tag) {
          case "AuthorizationChanged":
            setStatus(t("payApprovalChanged"));
            break;
          case "Sent":
            if (!notify) break;
            for (const error of outcome.publishErrors)
              pushToast(`${t("payFailed")}: ${error}`);
            showPaid(
              outcome.queued ? t("paidQueuedTo") : t("paidSentTo"),
              outcome.receipt.amount,
            );
            navigateTo({ id: outcome.contactId, route: "chat" });
            break;
          case "QueuedOffline":
            if (!notify) break;
            showPaid(t("paidQueuedTo"), amountSat);
            navigateTo({ id: outcome.contactId, route: "chat" });
            break;
          case "MissingIdentity":
            if (notify) setStatus(t("profileMissingNpub"));
            break;
          case "MissingContactNpub":
            if (notify) setStatus(t("chatMissingContactNpub"));
            break;
          case "InvalidContact":
            if (notify) setStatus(t("payFailed"));
            break;
          case "Insufficient":
            if (notify) setStatus(t("payInsufficient"));
            break;
          case "NotStored":
            if (notify) setStatus(`${t("payFailed")}: ${outcome.detail}`);
            break;
          case "Failed":
            if (notify)
              setStatus(
                outcome.insufficient
                  ? t("payInsufficient")
                  : `${t("payFailed")}: ${outcome.detail}`,
              );
            break;
          case "Busy":
            break;
        }
        return paymentResultOf(outcome);
      },
      [
        chat,
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

      const result = await payContactWithCashuMessage({
        contact,
        amountSat: offer.amountSat,
        logCompletedOnly: true,
        paymentNoticeContext: "bank_payment_offer",
        paymentNoticeOfferId: offer.offerId,
      });
      if (result.ok)
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

  usePaymentsDomain({
    cashuBalance,
    cashuIsBusy: walletOpRunning,
    cashuReady: commands !== null,
    contacts,
    currentNpub,
    currentNsec,
    payContactWithCashuMessage,
    pendingPaymentsKey,
    updateLocalNostrMessage: chat.updateLocalNostrMessage,
    pushToast,
    t,
  });

  return {
    payContactWithCashuMessage,
    paySelectedContact,
    settleBankPaymentOffer,
  };
};
