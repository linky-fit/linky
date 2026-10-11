import React from "react";
import type { ContactId } from "../../../evolu";
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
import { useLightningPayments } from "./useLightningPayments";

type ContactsMessaging = ReturnType<typeof useContactsMessagingComposition>;

interface UseWalletPaymentsParams {
  cashuBalance: number;
  contactPayBackToChatRef: React.MutableRefObject<ContactId | null>;
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
    | "openScannedContactPendingNpubRef"
    | "pendingPaymentsKey"
    | "respondToBankPaymentOfferWithGroupState"
    | "saveNpubContact"
    | "selectedChatContact"
    | "selectedContact"
    | "sendChatMessage"
    | "setContactsOnboardingHasPaid"
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
  payAmount: string;
  payWithCashuEnabled: boolean;
  pushToast: (message: string) => void;
  route: ReturnType<typeof useRouting>;
  setContactPaymentIntent: React.Dispatch<
    React.SetStateAction<"pay" | "request">
  >;
  setPayAmount: React.Dispatch<React.SetStateAction<string>>;
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
  contactPayBackToChatRef,
  contactsMessaging,
  currentNpub,
  currentNsec,
  defaultMintUrl,
  dismissPaymentSending,
  formatDisplayedAmountParts,
  lightningInvoiceAutoPayLimit,
  logPaymentEvent,
  meltToDefaultMint,
  payAmount,
  payWithCashuEnabled,
  pushToast,
  route,
  setContactPaymentIntent,
  setPayAmount,
  setStatus,
  showPaidOverlay,
  showPaymentSending,
  t,
  walletOpRunning,
}: UseWalletPaymentsParams) => {
  const { contacts, selectedContact, setContactsOnboardingHasPaid } =
    contactsMessaging;
  const [lnAddressPayAmount, setLnAddressPayAmount] = React.useState("");
  const [lnAddressPayNote, setLnAddressPayNote] = React.useState("");
  const [lnAddressPayContactId, setLnAddressPayContactId] =
    React.useState<ContactId | null>(null);
  const [contactPayMethod, setContactPayMethod] = React.useState<
    null | "cashu" | "lightning"
  >(null);

  useRouteAmountResetEffects({
    contactPayBackToChatRef,
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

  const rememberFirstPayment = useRememberFirstPayment(
    setContactsOnboardingHasPaid,
  );
  const mintMove = usePaymentMintMove({
    meltToDefaultMint,
    setStatus,
    t,
    walletOpRunning,
  });
  const setLnAddressPay = React.useCallback(
    (pay: { amount: string; note: string; contactId: ContactId }) => {
      setLnAddressPayAmount(pay.amount);
      setLnAddressPayNote(pay.note);
      setLnAddressPayContactId(pay.contactId);
    },
    [],
  );
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
    contacts,
    lnAddressPayContactId,
    nostrPictureByNpub: contactsMessaging.nostrPictureByNpub,
    routeKind: route.kind,
  });
  const paymentRequests = useCashuPaymentRequests({
    ...ui,
    ...contactsMessaging,
    autoPayLimit: lightningInvoiceAutoPayLimit,
    contactPayBackToChatRef,
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
    contactPayMethod,
    lnAddressPayAmount,
    lnAddressPayNote,
    paySelectedContact: contactPayments.paySelectedContact,
    pendingPaymentMintMeltConfirmation:
      mintMove.pendingPaymentMintMeltConfirmation,
    setContactPayMethod,
    setLnAddressPayAmount,
    setLnAddressPayNote,
    settleBankPaymentOffer: contactPayments.settleBankPaymentOffer,
  };
};
