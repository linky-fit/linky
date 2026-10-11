import type { TextField } from "@linky-fit/ui";
import type { PushToastOptions } from "../../../hooks/useToasts";
import type { ReceiveMethod } from "../../../utils/receiveMethod";
import { paidOverlayContact } from "../../lib/paidOverlay";
import { decodeNpub, encodeNprofile } from "@linky-fit/linkstr";
import React, { type ComponentRef, useMemo, useState } from "react";
import type { ContactId } from "../../../evolu";
import { useRouting } from "../../../hooks/useRouting";
import { recommendedNostrRelays } from "../../../utils/nostrRelays";
import {
  formatDisplayAmountParts,
  type FiatRates,
} from "../../../utils/displayAmounts";
import { type TransactionsRepository } from "@linky-fit/linksync";
import {
  formatMintHost,
  MAIN_MINT_URL,
  normalizeMintUrl,
} from "../../../utils/mint";
import {
  getInitialLightningInvoiceAutoPayLimit,
  getInitialPayWithCashuEnabled,
  getInitialReceiveMethod,
} from "../../../utils/storage";
import { useSaveCashuFromText } from "../cashu/useSaveCashuFromText";
import { useDeferredReceiveRetry } from "../cashu/useDeferredReceiveRetry";
import { useTopupFlow } from "../topup/useTopupFlow";
import { useAnonymousPaymentTelemetry } from "../useAnonymousPaymentTelemetry";
import { useCashuDomain } from "../useCashuDomain";
import { useMintDomain } from "../useMintDomain";
import { useAllowTestMints } from "../useAllowTestMints";
import { useMoveMintFunds } from "../mint/useMoveMintFunds";
import { planDefaultMintMove } from "../../state/wallet/moveFunds";
import { useDefaultMint } from "../wallet/useDefaultMint";
import { useNpubCash } from "../wallet/useNpubCash";
import { useLnurlWithdraw } from "../wallet/useLnurlWithdraw";
import { useRecurringPayments } from "../wallet/useRecurringPayments";
import { useTransferCleanup } from "../wallet/useTransferCleanup";
import { useWalletOps } from "../wallet/useWalletOps";
import { useWalletPayments } from "../wallet/useWalletPayments";
import { useWalletResumes } from "../wallet/useWalletResumes";
import { useWalletWarning } from "../wallet/useWalletWarning";
import { useWalletTokens } from "../wallet/useWalletTokens";
import { useOwnerStorage, usePaymentLog } from "../wallet/useWalletStorage";
import { usePaidOverlayState } from "../usePaidOverlayState";
import {
  isOpenTransfer,
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
  formatDisplayedAmountText: (amountSat: number) => string;
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
  formatDisplayedAmountText,
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
  const [receiveMethod, setReceiveMethod] = useState<ReceiveMethod>(() =>
    getInitialReceiveMethod(),
  );

  useAnonymousPaymentTelemetry({
    appOwnerId,
    makeLocalStorageKey,
  });

  const [cashuDraft, setCashuDraft] = useState("");
  const cashuDraftRef = React.useRef<ComponentRef<typeof TextField>>(null);
  const { runQueued, walletOpRunning: cashuIsBusy } = useWalletOps();

  const {
    dismissPaymentSending,
    paidOverlayDetails,
    paidOverlayIsOpen,
    paidOverlayPhase,
    paidOverlayTitle,
    showPaidOverlay,
    showPaymentSending,
    topupPaidNavTimerRef,
  } = usePaidOverlayState({
    t,
  });

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
    inspectCashuProofStates,
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
  } = useLinkshuComposition({ allowTestMints });

  const cashuOpenTransfers = React.useMemo(
    () => walletTransfers.filter(isOpenTransfer),
    [walletTransfers],
  );

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

  const cashuTotalBalance: number = walletBalances.total;
  const cashuBalance: number = walletBalances.spendable;

  const paymentMintMeltPlan = React.useMemo(
    () => planDefaultMintMove(walletBalances.perMint, defaultMintUrl),
    [defaultMintUrl, walletBalances.perMint],
  );

  const { estimateMintMove, meltToDefaultMint, moveMintFunds } =
    useMoveMintFunds({ formatDisplayedAmountParts, setStatus, t });

  const cashuBalanceAfterMelt = Math.max(
    cashuBalance,
    paymentMintMeltPlan?.maxBalanceAfterMove ?? 0,
  );

  const cashuHasMultipleAcceptedMints =
    new Set(walletBalances.perMint.map(({ mint }) => normalizeMintUrl(mint)))
      .size > 1;

  const canPayWithCashu = cashuBalance > 0;

  const {
    setTopupAmount,
    setTopupNote,
    startBackgroundTopup,
    topupAmount,
    topupNote,
    topupInvoice,
    topupInvoiceCashuRequest,
    topupInvoiceError,
    topupInvoiceIsBusy,
    topupInvoiceQrPayload,
    topupMintUrl,
  } = useTopupFlow({
    cashuTotalBalance,
    defaultMintUrl,
    formatDisplayedAmountParts,
    logPaymentEvent,
    resumePendingCashuTopups,
    routeKind: route.kind,
    showPaidOverlay,
    startCashuTopup,
    t,
    topupPaidNavTimerRef,
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
  const walletWarning = useWalletWarning(cashuBalance);

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

  const walletTokens = useWalletTokens({
    allowTestMints,
    cashuBalance,
    chat,
    defaultMintUrl,
    formatDisplayedAmountText,
    isMintDeleted,
    mintInfoDeduped,
    pushToast,
    readSeenMints: readSeenMintsFromStorage,
    recoverEnvelopes,
    rememberSeenMint,
    setStatus,
    t,
    walletMints,
    walletOpRunning: cashuIsBusy,
    walletProofs,
    walletTransfers,
  });

  const mainMintForTokenList = React.useMemo(
    () => normalizeMintUrl(defaultMintUrl ?? MAIN_MINT_URL),
    [defaultMintUrl],
  );

  const cashuMeltToMainMintButtonLabel =
    mainMintForTokenList && paymentMintMeltPlan
      ? t("cashuMeltToMainMint").replace(
          "{mint}",
          formatMintHost(mainMintForTokenList),
        )
      : null;

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
    ...walletTokens,
    ...lnurlWithdraw,
    ...walletWarning,
    recurringPaymentsContext,
    cashuTransferLifecycle,
    // Backup export and the Nostr bootstrap snapshot need every proof,
    // including hidden test-mint proofs; keep this unfiltered.
    allCashuProofs: allWalletProofs,
    allowTestMints,
    applyDefaultMintSelection,
    canPayWithCashu,
    cashuBalance,
    cashuBalanceAfterMelt,
    cashuDraft,
    cashuDraftRef,
    cashuHasMultipleAcceptedMints,
    cashuIsBusy,
    cashuMeltToMainMintButtonLabel,
    cashuOpenTransfers,
    cashuDeferredReceives: walletDeferredReceives,
    cashuProofs: walletProofs,
    cashuOperations: walletOperations,
    cashuTokensHydratedRef,
    cashuTotalBalance,
    cashuTransfers: walletTransfers,
    inspectCashuProofStates,
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
    paidOverlayDetails,
    paidOverlayIsOpen,
    paidOverlayPhase,
    paidOverlayTitle,
    payWithCashuEnabled,
    receiveMethod,
    probeLightningFee,
    refreshMintInfo,
    saveCashuFromText,
    setCashuDraft,
    setLightningInvoiceAutoPayLimit,
    setMintInfoAll,
    setAllowTestMints,
    setPayWithCashuEnabled,
    setReceiveMethod,
    setTopupAmount,
    setTopupNote,
    showPaidOverlay,
    topupAmount,
    topupNote,
    topupInvoice,
    topupInvoiceCashuRequest,
    topupInvoiceError,
    topupInvoiceIsBusy,
    topupInvoiceQrPayload,
    topupMintUrl,
  };
};
