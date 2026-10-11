import { useAtom, useAtomSet } from "@linky-fit/linkstr-react";
import React from "react";
import type { useRouting } from "../../../hooks/useRouting";
import type { Translate } from "../../../i18n";
import type { DisplayAmountParts } from "../../../utils/displayAmounts";
import type { PaidOverlayDetails } from "../../lib/paidOverlay";
import type { LoggedPaymentEventParams } from "../../types/appTypes";
import type { useContactsMessagingComposition } from "../composition/useContactsMessagingComposition";
import { useContactPayMethod } from "../payments/useContactPayMethod";
import { useRouteAmountResetEffects } from "../payments/useRouteAmountResetEffects";
import { usePaymentMintMove, useRememberFirstPayment } from "./paymentUi";
import { useCashuPaymentRequests } from "./useCashuPaymentRequests";
import { useContactPayments } from "./useContactPayments";
import {
  contactPayMethodAtom,
  contactPaymentIntentAtom,
  payAmountAtom,
} from "../../state/wallet/contactPay";
import { useLightningPayments } from "./useLightningPayments";
import { useLnAddressPayDraft } from "./usePaymentDrafts";

type ContactsMessaging = ReturnType<typeof useContactsMessagingComposition>;

interface UseWalletPaymentsParams {
  cashuBalance: number;
  contactsMessaging: Pick<
    ContactsMessaging,
    | "chatMessages"
    | "contacts"
    | "getBankPaymentOfferForSettlement"
    | "isBankPaymentOfferCanceled"
    | "latestMessages"
    | "nostrMessagesLocal"
    | "nostrMessagesRecent"
    | "nostrPictureByNpub"
    | "pendingPaymentsKey"
    | "respondToBankPaymentOfferWithGroupState"
    | "saveNpubContact"
    | "selectedChatContact"
    | "selectedContact"
    | "sendChatMessage"
    | "updateLocalNostrMessage"
  >;
  currentNpub: string | null;
  currentNsec: string | null;
  defaultMintUrl: string | null;
  dismissPaymentSending: () => void;
  formatDisplayedAmountParts: (amountSat: number) => DisplayAmountParts;
  lightningInvoiceAutoPayLimit: number;
  logPaymentEvent: (event: LoggedPaymentEventParams) => void;
  meltToDefaultMint: () => Promise<void>;
  payWithCashuEnabled: boolean;
  pushToast: (message: string) => void;
  route: ReturnType<typeof useRouting>;
  setStatus: React.Dispatch<React.SetStateAction<string | null>>;
  showPaidOverlay: (title?: string, details?: PaidOverlayDetails) => void;
  showPaymentSending: (details: PaidOverlayDetails) => void;
  t: Translate;
  walletOpRunning: boolean;
}

/**
 * Every payment the wallet screens start, with their drafts and
 * confirmations: contacts over messages, Lightning invoices and addresses,
 * NUT-18 payment requests and the mint move a short default mint needs.
 */
export const useWalletPayments = ({
  cashuBalance,
  contactsMessaging,
  currentNpub,
  currentNsec,
  defaultMintUrl,
  dismissPaymentSending,
  formatDisplayedAmountParts,
  lightningInvoiceAutoPayLimit,
  logPaymentEvent,
  meltToDefaultMint,
  payWithCashuEnabled,
  pushToast,
  route,
  setStatus,
  showPaidOverlay,
  showPaymentSending,
  t,
  walletOpRunning,
}: UseWalletPaymentsParams) => {
  const { selectedContact } = contactsMessaging;
  const [payAmount, setPayAmount] = useAtom(payAmountAtom);
  const setContactPaymentIntent = useAtomSet(contactPaymentIntentAtom);
  const [contactPayMethod, setContactPayMethod] = useAtom(contactPayMethodAtom);
  const {
    setLnAddressPay,
    setLnAddressPayAmount,
    setLnAddressPayContactId,
    setLnAddressPayNote,
  } = useLnAddressPayDraft();

  useRouteAmountResetEffects({
    routeKind: route.kind,
    setContactPaymentIntent,
    setLnAddressPayAmount,
    setLnAddressPayNote,
    setLnAddressPayContactId,
    setPayAmount,
  });
  useContactPayMethod({
    payWithCashuEnabled,
    routeKind: route.kind,
    selectedContactLnAddress: selectedContact?.lnAddress ?? "",
    selectedContactNpub: selectedContact?.npub ?? "",
    setContactPayMethod,
  });

  const rememberFirstPayment = useRememberFirstPayment();
  const mintMove = usePaymentMintMove({
    meltToDefaultMint,
    setStatus,
    t,
    walletOpRunning,
  });
  const ui = {
    dismissPaymentSending,
    formatDisplayedAmountParts,
    rememberFirstPayment,
    reportShortfall: mintMove.reportShortfall,
    setStatus,
    showPaidOverlay,
    showPaymentSending,
    t,
  };

  const contactPayments = useContactPayments({
    ...ui,
    ...contactsMessaging,
    cashuBalance,
    contactPayMethod,
    currentNpub,
    currentNsec,
    payAmount,
    pushToast,
    route,
    setLnAddressPay,
    walletOpRunning,
  });
  const lightningPayments = useLightningPayments({
    ...ui,
    routeKind: route.kind,
  });
  const paymentRequests = useCashuPaymentRequests({
    ...ui,
    ...contactsMessaging,
    autoPayLimit: lightningInvoiceAutoPayLimit,
    currentNpub,
    defaultMintUrl,
    logPaymentEvent,
    payAmount,
    payContactWithCashuMessage: contactPayments.payContactWithCashuMessage,
    route,
    walletOpRunning,
  });

  return {
    ...lightningPayments,
    ...paymentRequests,
    closePaymentMintMeltConfirmation: mintMove.closePaymentMintMeltConfirmation,
    confirmPaymentMintMelt: mintMove.confirmPaymentMintMelt,
    paySelectedContact: contactPayments.paySelectedContact,
    pendingPaymentMintMeltConfirmation:
      mintMove.pendingPaymentMintMeltConfirmation,
    settleBankPaymentOffer: contactPayments.settleBankPaymentOffer,
  };
};
