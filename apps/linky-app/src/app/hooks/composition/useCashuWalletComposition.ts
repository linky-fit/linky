import { useAtom, useAtomValue } from "@linky-fit/linkstr-react";
import type { PushToastOptions } from "../../../hooks/useToasts";
import { paidOverlayContact } from "../../lib/paidOverlay";
import React, { useMemo } from "react";
import { useRouting } from "../../../hooks/useRouting";
import {
  formatDisplayAmountParts,
  type FiatRates,
} from "../../../utils/displayAmounts";
import { type TransactionsRepository } from "@linky-fit/linksync";
import { useSaveCashuFromText } from "../cashu/useSaveCashuFromText";
import { useDeferredReceiveRetry } from "../cashu/useDeferredReceiveRetry";
import { useTopupFlow } from "../topup/useTopupFlow";
import { useAnonymousPaymentTelemetry } from "../useAnonymousPaymentTelemetry";
import { useOwnNprofile } from "../useOwnNprofile";
import { useCashuDomain } from "../useCashuDomain";
import { useMintInfo, useMintInfoWatchers } from "../mint/useMintInfo";
import { useAllowTestMints } from "../useAllowTestMints";
import { useMoveMintFunds } from "../mint/useMoveMintFunds";
import { useRequestMintUrls } from "../mint/useRequestMintUrls";
import {
  lightningInvoiceAutoPayLimitAtom,
  payWithCashuEnabledAtom,
} from "../../state/wallet/prefs";
import { receiveTokenDraftAtom } from "../../state/wallet/tokenActivity";
import { useDefaultMint } from "../wallet/useDefaultMint";
import { useNpubCash } from "../wallet/useNpubCash";
import { useLnurlWithdraw } from "../wallet/useLnurlWithdraw";
import { useReceivedSatByRequestId } from "../wallet/useReceivedSatByRequestId";
import { useRecurringPayments } from "../wallet/useRecurringPayments";
import { useTransferCleanup } from "../wallet/useTransferCleanup";
import { useWalletOps } from "../wallet/useWalletOps";
import { useWalletPayments } from "../wallet/useWalletPayments";
import { useWalletResumes } from "../wallet/useWalletResumes";
import { useWalletBalance } from "../wallet/useWalletInventory";
import {
  useIssuedTokenClaimWatch,
  useTokenRecovery,
} from "../wallet/useWalletTokens";
import { useOwnerStorage, usePaymentLog } from "../wallet/useWalletStorage";
import { walletCommandsAtom } from "../../state/wallet/walletCommands";
import { useProvideOwnerCommands } from "../shell/ownerCommands";
import { usePaidOverlayCommands } from "../shell";
import { isPendingDeferredReceive } from "../../lib/cashuTransfers";
import { useContactsMessagingComposition } from "./useContactsMessagingComposition";
import { useIdentityOwnersComposition } from "./useIdentityOwnersComposition";
import { useLinkshuComposition } from "./useLinkshuComposition";
import { useInterruptedReceiveRecovery } from "../cashu/useInterruptedReceiveRecovery";
import { useProfileComposition } from "./useProfileComposition";
import type { Translate } from "../../../i18n";

type IdentityOwnersCompositionResult = ReturnType<
  typeof useIdentityOwnersComposition
>;
type ContactsMessagingCompositionResult = ReturnType<
  typeof useContactsMessagingComposition
>;
type ProfileCompositionResult = ReturnType<typeof useProfileComposition>;

interface UseCashuWalletCompositionParams {
  copyText: (value: string) => Promise<void>;
  contactsMessaging: Pick<
    ContactsMessagingCompositionResult,
    | "saveNpubContact"
    | "appendLocalNostrMessage"
    | "chatMessages"
    | "contacts"
    | "getBankPaymentOfferForSettlement"
    | "isBankPaymentOfferCanceled"
    | "nostrBootstrapReady"
    | "latestMessages"
    | "nostrMessagesLocal"
    | "nostrMessagesRecent"
    | "nostrPictureByNpub"
    | "respondToBankPaymentOfferWithGroupState"
    | "selectedChatContact"
    | "selectedContact"
    | "sendChatMessage"
    | "updateLocalNostrMessage"
  >;
  fiatRates: FiatRates | null;
  formatDisplayedAmountParts: (
    amountSat: number,
  ) => ReturnType<typeof formatDisplayAmountParts>;
  identity: Pick<
    IdentityOwnersCompositionResult,
    "appOwnerId" | "currentNpub" | "currentNsec"
  >;
  maybeShowPwaNotification: (
    title: string,
    body: string,
    tag?: string,
  ) => Promise<void>;
  profile: Pick<
    ProfileCompositionResult,
    | "npubCashInfoInFlightRef"
    | "npubCashInfoLoadedAtMsRef"
    | "npubCashInfoLoadedForNpubRef"
    | "setIsProfileEditing"
    | "setOwnedProfileLightningAddresses"
    | "setOwnedProfileLightningAddressesLoading"
  >;
  pushToast: (message: string, options?: PushToastOptions) => void;
  route: ReturnType<typeof useRouting>;
  setStatus: React.Dispatch<React.SetStateAction<string | null>>;
  t: Translate;
  transactions: Pick<TransactionsRepository, "all" | "update">;
}

export const useCashuWalletComposition = ({
  copyText,
  contactsMessaging,
  fiatRates,
  formatDisplayedAmountParts,
  identity,
  maybeShowPwaNotification,
  profile,
  pushToast,
  route,
  setStatus,
  t,
  transactions,
}: UseCashuWalletCompositionParams) => {
  const { allowTestMints } = useAllowTestMints();
  const { appOwnerId, currentNpub, currentNsec } = identity;
  const {
    appendLocalNostrMessage,
    chatMessages,
    contacts,
    nostrBootstrapReady,
    nostrMessagesLocal,
    nostrMessagesRecent,
    updateLocalNostrMessage,
  } = contactsMessaging;
  const { logPaymentEvent, migrateLegacyPaymentEvents } = usePaymentLog();
  const {
    key: makeLocalStorageKey,
    readSeenMints: readSeenMintsFromStorage,
    rememberSeenMint,
  } = useOwnerStorage();

  const { defaultMintChoice, defaultMintUrl, suggestDefaultMint } =
    useDefaultMint();

  const payWithCashuEnabled = useAtomValue(payWithCashuEnabledAtom);
  const lightningInvoiceAutoPayLimit = useAtomValue(
    lightningInvoiceAutoPayLimitAtom,
  );

  useAnonymousPaymentTelemetry({
    appOwnerId,
    makeLocalStorageKey,
  });

  const [, setCashuDraft] = useAtom(receiveTokenDraftAtom);
  const { runQueued, walletOpRunning: cashuIsBusy } = useWalletOps();

  const { dismissPaymentSending, showPaidOverlay, showPaymentSending } =
    usePaidOverlayCommands();

  React.useEffect(() => {
    migrateLegacyPaymentEvents();
  }, [migrateLegacyPaymentEvents]);

  const topupRecipientNprofile = useOwnNprofile(currentNpub);

  const {
    cashuEnvelopes,
    cashuTransferLifecycle,
    meltCashuInvoice,
    receiveCashuToken,
    resumeDeferredCashuReceives,
    resumePendingCashuAutoswapClaims,
    resumePendingCashuMelts,
    resumePendingCashuTopups,
    sendCashuToken,
    startCashuTopup,
    walletBalances,
    walletLoaded,
    walletOperations,
    walletProofs,
    walletTransfers,
  } = useLinkshuComposition();

  const {
    cashuTokensHydratedRef,
    isCashuTokenKnownAny,
    isCashuTokenStored,
    rememberCashuTokenKnown,
  } = useCashuDomain({ cashuTransfers: walletTransfers, walletLoaded });

  const {
    isMintDeleted,
    mintInfoByUrl,
    mintInfoDeduped,
    refreshMintInfo,
    touchMintInfo,
  } = useMintInfo();
  useMintInfoWatchers({ allowTestMints, defaultMintUrl, walletProofs });

  useTransferCleanup({
    chatMessages,
    contacts,
    currentNpub,
    lifecycle: cashuTransferLifecycle,
    nostrMessagesLocal,
    nostrMessagesRecent,
    walletTransfers,
  });
  useWalletResumes({
    pushToast,
    receiveCashuToken,
    resumePendingCashuAutoswapClaims,
    resumePendingCashuMelts,
    t,
    transactions,
  });

  const { cashuBalance } = useWalletBalance();
  const requestMintUrls = useRequestMintUrls();
  const receivedSatByRequestId = useReceivedSatByRequestId();

  const { meltToDefaultMint } = useMoveMintFunds();

  const { startBackgroundTopup } = useTopupFlow({
    defaultMintUrl,
    formatDisplayedAmountParts,
    logPaymentEvent,
    receivedSatByRequestId,
    requestMintUrls,
    resumePendingCashuTopups,
    routeKind: route.kind,
    showPaidOverlay,
    startCashuTopup,
    t,
    topupRecipientNprofile,
  });

  useNpubCash({
    ...profile,
    copyText,
    currentNpub,
    currentNsec,
    // npub.cash keeps the stored choice; the test-mint fallback stays local.
    defaultMintChoice,
    formatDisplayedAmountParts,
    isMintDeleted,
    maybeShowPwaNotification,
    mintInfoByUrl,
    networkEnabled: nostrBootstrapReady,
    pushToast,
    refreshMintInfo,
    rememberCashuTokenKnown,
    routeKind: route.kind,
    setStatus,
    showPaidOverlay,
    suggestDefaultMint,
    t,
    touchMintInfo,
  });

  const walletPayments = useWalletPayments({
    cashuBalance,
    contactsMessaging,
    currentNpub,
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
    walletOpRunning: cashuIsBusy,
  });
  const lnurlWithdraw = useLnurlWithdraw({
    defaultMintUrl,
    setStatus,
    startBackgroundTopup,
    t,
  });

  const findPaidOverlayContact = React.useCallback(
    (contactId: string) =>
      paidOverlayContact(
        contacts.find((contact) => (contact.id ?? "") === contactId),
      ),
    [contacts],
  );
  const saveCashuFromText = useSaveCashuFromText({
    allowTestMints,
    findContact: findPaidOverlayContact,
    formatDisplayedAmountParts,
    isCashuTokenStored,
    isMintDeleted,
    logPaymentEvent,
    mintInfoByUrl,
    receiveCashuToken,
    refreshMintInfo,
    rememberCashuTokenKnown,
    setCashuDraft,
    runQueued,
    setStatus,
    showPaidOverlay,
    t,
    touchMintInfo,
  });

  useInterruptedReceiveRecovery({
    cashuTransfers: walletTransfers,
    messages: nostrMessagesRecent,
    ready: walletLoaded && nostrBootstrapReady && receiveCashuToken !== null,
    saveCashuFromText,
  });

  // Every mint the wallet ever touched, spent proofs included: a mint whose
  // proofs are all spent must still be offered to a recovery.
  const walletMints = React.useMemo(() => {
    const mints = new Set<string>();
    for (const proof of walletProofs) mints.add(proof.mint);
    for (const operation of walletOperations) {
      mints.add(operation.mint);
      if (operation.sourceMint !== null) mints.add(operation.sourceMint);
    }
    return [...mints];
  }, [walletOperations, walletProofs]);

  const chat = useMemo(
    () => ({
      appendLocalNostrMessage,
      nostrMessagesLocal,
      updateLocalNostrMessage,
    }),
    [appendLocalNostrMessage, nostrMessagesLocal, updateLocalNostrMessage],
  );
  const { recoverEnvelopes } = useRecurringPayments({
    chat,
    contacts,
    currentNpub,
    currentNsec,
    envelopes: cashuEnvelopes,
    fiatRates,
    formatDisplayedAmountParts,
    logPaymentEvent,
    maybeShowPwaNotification,
    mintBalances: walletBalances.perMint,
    pushToast,
    showPaidOverlay,
    t,
    walletReady: sendCashuToken !== null && meltCashuInvoice !== null,
  });

  const tokenRecovery = useTokenRecovery({
    allowTestMints,
    defaultMintUrl,
    isMintDeleted,
    mintInfoDeduped,
    readSeenMints: readSeenMintsFromStorage,
    recoverEnvelopes,
    rememberSeenMint,
    walletMints,
  });
  useIssuedTokenClaimWatch({ walletProofs, walletTransfers });

  useDeferredReceiveRetry({
    // Hidden test-mint deferrals are retried too, so they keep the backoff running.
    deferredCount: walletOperations.filter(isPendingDeferredReceive).length,
    runQueued,
    formatDisplayedAmountParts,
    isMintDeleted,
    logPaymentEvent,
    mintInfoByUrl,
    refreshMintInfo,
    rememberCashuTokenKnown,
    resumeDeferredCashuReceives,
    showPaidOverlay,
    t,
    touchMintInfo,
  });

  useProvideOwnerCommands(walletCommandsAtom, {
    closeCashuPaymentRequestConfirmation:
      walletPayments.closeCashuPaymentRequestConfirmation,
    closeLightningInvoiceConfirmation:
      walletPayments.closeLightningInvoiceConfirmation,
    closeLnurlWithdrawConfirmation:
      lnurlWithdraw.closeLnurlWithdrawConfirmation,
    closePaymentMintMeltConfirmation:
      walletPayments.closePaymentMintMeltConfirmation,
    confirmCashuPaymentRequest: walletPayments.confirmCashuPaymentRequest,
    enterCashuPaymentRequestAmount:
      walletPayments.enterCashuPaymentRequestAmount,
    confirmLightningInvoicePayment:
      walletPayments.confirmLightningInvoicePayment,
    confirmLnurlWithdraw: lnurlWithdraw.confirmLnurlWithdraw,
    confirmPaymentMintMelt: walletPayments.confirmPaymentMintMelt,
    payChatPaymentRequest: walletPayments.onPayChatPaymentRequest,
    payLightningAddressWithCashu: walletPayments.payLightningAddressWithCashu,
    payLightningInvoiceWithCashu: walletPayments.payLightningInvoiceWithCashu,
    paySelectedContact: walletPayments.paySelectedContact,
    reclaimHandedOutTokens: tokenRecovery.reclaimHandedOutTokens,
    requestSelectedContact: walletPayments.requestSelectedContact,
    restoreAndReclaimAllTokens: tokenRecovery.restoreAndReclaimAllTokens,
    restoreMissingTokens: tokenRecovery.restoreMissingTokens,
    saveCashuFromText,
    settleBankPaymentOffer: walletPayments.settleBankPaymentOffer,
  });

  return {
    canPayCashuRequest: walletPayments.canPayCashuRequest,
    cashuBalance,
    cashuIsBusy,
    /** saveCashuFromText can receive: the wallet is loaded and its commands exist. */
    cashuReceiveReady: walletLoaded && receiveCashuToken !== null,
    cashuTokensHydratedRef,
    isCashuTokenKnownAny,
    isCashuTokenStored,
    lightningInvoiceAutoPayLimit,
    payCashuPaymentRequest: walletPayments.payCashuPaymentRequest,
    payLightningInvoiceWithCashu: walletPayments.payLightningInvoiceWithCashu,
    saveCashuFromText,
  };
};
