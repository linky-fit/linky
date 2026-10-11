import { useAtom } from "@linky-fit/linkstr-react";
import type { PushToastOptions } from "../../../hooks/useToasts";
import { paidOverlayContact } from "../../lib/paidOverlay";
import { decodeNpub, encodeNprofile } from "@linky-fit/linkstr";
import React, { useMemo, useState } from "react";
import type { ContactId } from "../../../evolu";
import { useRouting } from "../../../hooks/useRouting";
import { recommendedNostrRelays } from "../../../utils/nostrRelays";
import {
  formatDisplayAmountParts,
  type FiatRates,
} from "../../../utils/displayAmounts";
import { type TransactionsRepository } from "@linky-fit/linksync";
import {
  getInitialLightningInvoiceAutoPayLimit,
  getInitialPayWithCashuEnabled,
} from "../../../utils/storage";
import { useSaveCashuFromText } from "../cashu/useSaveCashuFromText";
import { useDeferredReceiveRetry } from "../cashu/useDeferredReceiveRetry";
import { useTopupFlow } from "../topup/useTopupFlow";
import { useAnonymousPaymentTelemetry } from "../useAnonymousPaymentTelemetry";
import { useCashuDomain } from "../useCashuDomain";
import { useMintDomain } from "../useMintDomain";
import { useAllowTestMints } from "../useAllowTestMints";
import { useMoveMintFunds } from "../mint/useMoveMintFunds";
import { receiveMethodAtom } from "../../state/wallet/prefs";
import { receiveTokenDraftAtom } from "../../state/wallet/tokenActivity";
import { useDefaultMint } from "../wallet/useDefaultMint";
import { useNpubCash } from "../wallet/useNpubCash";
import { useLnurlWithdraw } from "../wallet/useLnurlWithdraw";
import { useRecurringPayments } from "../wallet/useRecurringPayments";
import { useTransferCleanup } from "../wallet/useTransferCleanup";
import { useWalletOps } from "../wallet/useWalletOps";
import { useWalletPayments } from "../wallet/useWalletPayments";
import { useWalletResumes } from "../wallet/useWalletResumes";
import { useWalletBalance } from "../wallet/useWalletInventory";
import {
  useIssuedTokenClaimWatch,
  useTokenContactSend,
  useTokenRecovery,
  useWalletTokens,
} from "../wallet/useWalletTokens";
import { useOwnerStorage, usePaymentLog } from "../wallet/useWalletStorage";
import { usePaidOverlay, usePaidOverlayCommands } from "../shell";
import {
  isPendingDeferredReceive,
  takenTokenTexts,
} from "../../lib/cashuTransfers";
import { getCashuTokenMessageInfo as getCashuTokenMessageInfoBase } from "../../lib/tokenMessageInfo";
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
  contactPayBackToChatRef: React.MutableRefObject<ContactId | null>;
  copyText: (value: string) => Promise<void>;
  contactsMessaging: Pick<
    ContactsMessagingCompositionResult,
    | "saveNpubContact"
    | "appendLocalNostrMessage"
    | "chatMessages"
    | "contacts"
    | "enqueuePendingPayment"
    | "getBankPaymentOfferForSettlement"
    | "isBankPaymentOfferCanceled"
    | "nostrBootstrapReady"
    | "nostrMessagesLatestRef"
    | "nostrMessagesLocal"
    | "nostrMessagesRecent"
    | "nostrPictureByNpub"
    | "openScannedContactPendingNpubRef"
    | "pendingPaymentsKey"
    | "respondToBankPaymentOfferWithGroupState"
    | "selectedChatContact"
    | "selectedContact"
    | "sendChatMessage"
    | "setContactsOnboardingHasPaid"
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
  payAmount: string;
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
  setContactPaymentIntent: React.Dispatch<
    React.SetStateAction<"pay" | "request">
  >;
  setPayAmount: React.Dispatch<React.SetStateAction<string>>;
  setStatus: React.Dispatch<React.SetStateAction<string | null>>;
  t: Translate;
  transactions: Pick<TransactionsRepository, "all" | "update">;
}

export const useCashuWalletComposition = ({
  contactPayBackToChatRef,
  copyText,
  contactsMessaging,
  fiatRates,
  formatDisplayedAmountParts,
  identity,
  maybeShowPwaNotification,
  payAmount,
  profile,
  pushToast,
  route,
  setContactPaymentIntent,
  setPayAmount,
  setStatus,
  t,
  transactions,
}: UseCashuWalletCompositionParams) => {
  const { allowTestMints, setAllowTestMints } = useAllowTestMints();
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

  const {
    defaultMintChoice,
    defaultMintUrl,
    setDefaultMint,
    suggestDefaultMint,
  } = useDefaultMint();

  const [payWithCashuEnabled, setPayWithCashuEnabled] = useState<boolean>(() =>
    getInitialPayWithCashuEnabled(),
  );
  const [lightningInvoiceAutoPayLimit, setLightningInvoiceAutoPayLimit] =
    useState<number>(() => getInitialLightningInvoiceAutoPayLimit());
  const [receiveMethod, setReceiveMethod] = useAtom(receiveMethodAtom);

  useAnonymousPaymentTelemetry({
    appOwnerId,
    makeLocalStorageKey,
  });

  const [, setCashuDraft] = useAtom(receiveTokenDraftAtom);
  const { runQueued, walletOpRunning: cashuIsBusy } = useWalletOps();

  const { dismissPaymentSending, showPaidOverlay, showPaymentSending } =
    usePaidOverlayCommands();
  const paidOverlay = usePaidOverlay();

  React.useEffect(() => {
    migrateLegacyPaymentEvents();
  }, [migrateLegacyPaymentEvents]);

  const topupRecipientNprofile = React.useMemo(() => {
    const pubkey = decodeNpub(currentNpub ?? "");
    return pubkey ? encodeNprofile(pubkey, recommendedNostrRelays()) : null;
  }, [currentNpub]);

  const {
    allWalletProofs,
    cashuEnvelopes,
    cashuTransferLifecycle,
    fetchMintInfo,
    meltCashuInvoice,
    probeLightningFee,
    receiveCashuToken,
    resumeDeferredCashuReceives,
    resumePendingCashuAutoswapClaims,
    resumePendingCashuMelts,
    resumePendingCashuTopups,
    sendCashuToken,
    startCashuTopup,
    walletBalances,
    walletDeferredReceives,
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
    getMintIconUrl,
    getMintRuntime,
    isMintDeleted,
    markMintIconFailed,
    mintInfoByUrl,
    mintInfoDeduped,
    refreshMintInfo,
    setMintInfoAll,
    touchMintInfo,
  } = useMintDomain({
    allowTestMints,
    appOwnerId,
    walletProofs,
    defaultMintUrl,
    fetchMintInfo,
    rememberSeenMint,
  });

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

  const {
    cashuBalance,
    cashuBalanceAfterMelt,
    cashuMeltToMainMintButtonLabel,
    cashuTotalBalance,
  } = useWalletBalance();

  const { estimateMintMove, meltToDefaultMint, moveMintFunds } =
    useMoveMintFunds();

  const { startBackgroundTopup } = useTopupFlow({
    cashuTotalBalance,
    defaultMintUrl,
    formatDisplayedAmountParts,
    logPaymentEvent,
    resumePendingCashuTopups,
    routeKind: route.kind,
    showPaidOverlay,
    startCashuTopup,
    t,
    topupRecipientNprofile,
  });

  const defaultMintDisplay = useMemo(() => {
    if (!defaultMintUrl) return null;
    try {
      const u = new URL(defaultMintUrl);
      return u.host;
    } catch {
      return defaultMintUrl;
    }
  }, [defaultMintUrl]);

  const { applyDefaultMintSelection, makeNip98AuthHeader } = useNpubCash({
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
    setDefaultMint,
    setStatus,
    showPaidOverlay,
    suggestDefaultMint,
    t,
    touchMintInfo,
  });

  const walletPayments = useWalletPayments({
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
  const { recoverEnvelopes, recurringPaymentsContext } = useRecurringPayments({
    chat,
    contacts,
    currentNpub,
    currentNsec,
    defaultMintUrl,
    envelopes: cashuEnvelopes,
    fiatRates,
    formatDisplayedAmountParts,
    logPaymentEvent,
    maybeShowPwaNotification,
    mintBalances: walletBalances.perMint,
    payWithCashuEnabled,
    pushToast,
    showPaidOverlay,
    t,
    walletReady: sendCashuToken !== null && meltCashuInvoice !== null,
  });

  const {
    discardCashuDeferredReceive,
    markCashuTokenExternalized,
    markCashuTokenIssued,
  } = useWalletTokens();
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
  const tokenContactSend = useTokenContactSend({ chat, walletTransfers });
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

  const knownTransferTexts = React.useMemo(
    () => takenTokenTexts(walletTransfers, walletOperations),
    [walletOperations, walletTransfers],
  );
  const getCashuTokenMessageInfo = React.useCallback(
    (text: string) =>
      getCashuTokenMessageInfoBase(text, knownTransferTexts, allowTestMints),
    [allowTestMints, knownTransferTexts],
  );

  return {
    ...walletPayments,
    ...tokenRecovery,
    ...tokenContactSend,
    ...lnurlWithdraw,
    ...paidOverlay,
    discardCashuDeferredReceive,
    markCashuTokenExternalized,
    markCashuTokenIssued,
    recurringPaymentsContext,
    cashuTransferLifecycle,
    // Backup export and the Nostr bootstrap snapshot need every proof,
    // including hidden test-mint proofs; keep this unfiltered.
    allCashuProofs: allWalletProofs,
    allowTestMints,
    applyDefaultMintSelection,
    cashuBalance,
    cashuBalanceAfterMelt,
    cashuIsBusy,
    cashuMeltToMainMintButtonLabel,
    cashuDeferredReceives: walletDeferredReceives,
    cashuProofs: walletProofs,
    cashuOperations: walletOperations,
    cashuTokensHydratedRef,
    cashuTransfers: walletTransfers,
    defaultMintDisplay,
    defaultMintUrl,
    estimateMintMove,
    getCashuTokenMessageInfo,
    getMintIconUrl,
    getMintRuntime,
    isCashuTokenKnownAny,
    isCashuTokenStored,
    lightningInvoiceAutoPayLimit,
    makeNip98AuthHeader,
    markMintIconFailed,
    meltLargestForeignMintToMainMint: meltToDefaultMint,
    mintInfoByUrl,
    moveMintFunds,
    payWithCashuEnabled,
    receiveMethod,
    probeLightningFee,
    refreshMintInfo,
    saveCashuFromText,
    setLightningInvoiceAutoPayLimit,
    setMintInfoAll,
    setAllowTestMints,
    setPayWithCashuEnabled,
    setReceiveMethod,
  };
};
