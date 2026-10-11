import type { TextField } from "@linky-fit/ui";
import type { PushToastOptions } from "../../../hooks/useToasts";
import type { ReceiveMethod } from "../../../utils/receiveMethod";
import { paidOverlayContact } from "../../lib/paidOverlay";
import { decodeNpub, encodeNprofile } from "@linky-fit/linkstr";
import { Result } from "effect";
import React, { type ComponentRef, useMemo, useState } from "react";
import type { ContactId } from "../../../evolu";
import { useRouting } from "../../../hooks/useRouting";
import { useRecurringPaymentOrders } from "../payments/useRecurringPaymentOrders";
import { useRecurringReminderSync } from "../payments/useRecurringReminderSync";
import {
  redeemLnurlWithdraw,
  type LnurlWithdrawPreview,
} from "../../../lnurlPay";
import { recommendedNostrRelays } from "../../../utils/nostrRelays";
import {
  WALLET_WARNING_BALANCE_THRESHOLD_SAT,
  WALLET_WARNING_DISMISSED_STORAGE_KEY,
} from "../../../utils/constants";
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
  safeLocalStorageGet,
  safeLocalStorageSet,
} from "../../../utils/storage";
import { getUnknownErrorMessage } from "../../../utils/unknown";
import { useSaveCashuFromText } from "../cashu/useSaveCashuFromText";
import { useDeferredReceiveRetry } from "../cashu/useDeferredReceiveRetry";
import { normalizePubkeyHex } from "../messages/contactIdentity";
import { useContactPayMethod } from "../payments/useContactPayMethod";
import { useRouteAmountResetEffects } from "../payments/useRouteAmountResetEffects";
import { useTopupFlow } from "../topup/useTopupFlow";
import { useAnonymousPaymentTelemetry } from "../useAnonymousPaymentTelemetry";
import { useCashuDomain } from "../useCashuDomain";
import { useMintDomain } from "../useMintDomain";
import { useAllowTestMints } from "../useAllowTestMints";
import { useMoveMintFunds } from "../mint/useMoveMintFunds";
import { planDefaultMintMove } from "../../state/wallet/moveFunds";
import { useDefaultMint } from "../wallet/useDefaultMint";
import { useCashuPaymentRequests } from "../wallet/useCashuPaymentRequests";
import { useContactPayments } from "../wallet/useContactPayments";
import { useLightningPayments } from "../wallet/useLightningPayments";
import {
  usePaymentMintMove,
  useRememberFirstPayment,
} from "../wallet/paymentUi";
import { useNpubCash } from "../wallet/useNpubCash";
import { useWalletOps } from "../wallet/useWalletOps";
import { useWalletTokens } from "../wallet/useWalletTokens";
import { logPayStep } from "../../state/wallet/paymentLog";
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
import { drainLegacyAcceptedCashuToken } from "../../migrations/legacyAcceptedTokenDrain";
import { useLinkshuComposition } from "./useLinkshuComposition";
import {
  useAccountHydrated,
  useRecurringPaymentsRepository,
} from "../useLinksync";
import { useMeltRecovery } from "../payments/useMeltRecovery";
import { useRecurringPaymentsActions } from "../payments/useRecurringPaymentsActions";
import { useRecurringPaymentsScheduler } from "../payments/useRecurringPaymentsScheduler";
import { useSendTokenMessage } from "../payments/useSendTokenMessage";
import { useInterruptedReceiveRecovery } from "../cashu/useInterruptedReceiveRecovery";
import { useResumeOnLaunchAndOnline } from "../useResumeOnLaunchAndOnline";
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
  const recurringPaymentsRepository = useRecurringPaymentsRepository();
  const accountHydrated = useAccountHydrated();
  const { allowTestMints, setAllowTestMints } = useAllowTestMints();
  const { appOwnerId, currentNpub, currentNsec } = identity;
  const {
    saveNpubContact,
    appendLocalNostrMessage,
    chatMessages,
    contacts,
    enqueuePendingPayment,
    getBankPaymentOfferForSettlement,
    isBankPaymentOfferCanceled,
    nostrBootstrapReady,
    nostrMessagesLatestRef,
    nostrMessagesLocal,
    nostrMessagesRecent,
    nostrPictureByNpub,
    openScannedContactPendingNpubRef,
    pendingPaymentsKey,
    respondToBankPaymentOfferWithGroupState,
    selectedChatContact,
    selectedContact,
    sendChatMessage,
    setContactsOnboardingHasPaid,
    updateLocalNostrMessage,
  } = contactsMessaging;
  const {
    npubCashInfoInFlightRef,
    npubCashInfoLoadedAtMsRef,
    npubCashInfoLoadedForNpubRef,
    setIsProfileEditing,
    setOwnedProfileLightningAddresses,
    setOwnedProfileLightningAddressesLoading,
  } = profile;
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

  const [lnAddressPayAmount, setLnAddressPayAmount] = useState<string>("");
  const [lnAddressPayNote, setLnAddressPayNote] = useState<string>("");
  const [lnAddressPayContactId, setLnAddressPayContactId] =
    useState<ContactId | null>(null);

  const [
    pendingLnurlWithdrawConfirmation,
    setPendingLnurlWithdrawConfirmation,
  ] = useState<LnurlWithdrawPreview | null>(null);
  const [lnurlWithdrawIsBusy, setLnurlWithdrawIsBusy] = useState(false);

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

  useRouteAmountResetEffects({
    contactPayBackToChatRef,
    routeKind: route.kind,
    setContactPaymentIntent,
    setLnAddressPayAmount,
    setLnAddressPayNote,
    setLnAddressPayContactId,
    setPayAmount,
  });

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

  // Legacy migration; removal gate in app/migrations/AGENTS.md
  React.useEffect(() => {
    if (receiveCashuToken === null) return;
    void drainLegacyAcceptedCashuToken(receiveCashuToken);
  }, [receiveCashuToken]);

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

  // A messenger send whose token message is confirmed sent has reached its
  // recipient; the pending transfer has nothing left to guard.
  React.useEffect(() => {
    if (cashuTransferLifecycle === null) return;
    for (const transfer of walletTransfers) {
      if (transfer.kind !== "send" || transfer.status !== "pending") continue;
      const hasMessage = nostrMessagesLocal.some((m) => {
        const isOut = m.direction === "out";
        const matches = m.content.trim() === transfer.tokenText;
        const status = m.status ?? "sent";
        return isOut && matches && status !== "pending";
      });
      if (!hasMessage) continue;
      void cashuTransferLifecycle.forget(transfer.id);
    }
  }, [cashuTransferLifecycle, nostrMessagesLocal, walletTransfers]);

  // A cashu token paid to our own key lands back in our own inbox as an
  // incoming message the auto-claim skips (its proofs are already ours). A
  // token sent to anyone else never returns to us, so an incoming message
  // carrying one of our own still-open sends is unambiguously a self-payment;
  // reclaim that transfer back into the balance instead of leaving it stuck.
  const selfSendReclaimAttemptedRef = React.useRef<Set<string>>(new Set());
  React.useEffect(() => {
    const lifecycle = cashuTransferLifecycle;
    if (lifecycle === null) return;
    const ownPubkeyHex = normalizePubkeyHex(decodeNpub(currentNpub ?? ""));
    if (!ownPubkeyHex) return;
    // A self-payment resolves the request to a contact whose key is our own;
    // that contact's display name may be wrong, but its npub is ours.
    const selfContactIds = new Set(
      contacts
        .filter(
          (contact) =>
            normalizePubkeyHex(decodeNpub(contact.npub ?? "")) === ownPubkeyHex,
        )
        .map((contact) => String(contact.id).trim())
        .filter((id) => id.length > 0),
    );
    // A token that reached our own inbox (direction "in") or that we sent into
    // a self-chat is a self-payment; a token sent to anyone else never matches
    // one of our own open transfers here, so this cannot reclaim a real send.
    const selfDirectedTokenTexts = new Set(
      [...chatMessages, ...nostrMessagesRecent, ...nostrMessagesLocal]
        .filter((message) => {
          if (message.direction === "in") return true;
          const contactId = (message.contactId ?? "").toString().trim();
          return contactId.length > 0 && selfContactIds.has(contactId);
        })
        .map((message) => message.content.trim()),
    );
    for (const transfer of walletTransfers) {
      if (transfer.kind !== "send" || !isOpenTransfer(transfer)) continue;
      const id = String(transfer.id);
      if (selfSendReclaimAttemptedRef.current.has(id)) continue;
      if (!selfDirectedTokenTexts.has(transfer.tokenText.trim())) continue;
      selfSendReclaimAttemptedRef.current.add(id);
      void lifecycle.returnToWallet(transfer.id);
    }
  }, [
    cashuTransferLifecycle,
    contacts,
    currentNpub,
    chatMessages,
    nostrMessagesRecent,
    nostrMessagesLocal,
    walletTransfers,
  ]);

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
    npubCashInfoInFlightRef,
    npubCashInfoLoadedAtMsRef,
    npubCashInfoLoadedForNpubRef,
    pushToast,
    refreshMintInfo,
    rememberCashuTokenKnown,
    routeKind: route.kind,
    setDefaultMint,
    setIsProfileEditing,
    setOwnedProfileLightningAddresses,
    setOwnedProfileLightningAddressesLoading,
    setStatus,
    showPaidOverlay,
    suggestDefaultMint,
    t,
    touchMintInfo,
  });

  const [contactPayMethod, setContactPayMethod] = useState<
    null | "cashu" | "lightning"
  >(null);
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
  const {
    closePaymentMintMeltConfirmation,
    confirmPaymentMintMelt,
    pendingPaymentMintMeltConfirmation,
    reportShortfall,
  } = usePaymentMintMove({
    meltToDefaultMint,
    setStatus,
    t,
    walletOpRunning: cashuIsBusy,
  });
  const chat = useMemo(
    () => ({
      appendLocalNostrMessage,
      enqueuePendingPayment,
      nostrMessagesLocal,
      updateLocalNostrMessage,
    }),
    [
      appendLocalNostrMessage,
      enqueuePendingPayment,
      nostrMessagesLocal,
      updateLocalNostrMessage,
    ],
  );
  const setLnAddressPay = React.useCallback(
    (pay: { amount: string; note: string; contactId: ContactId }) => {
      setLnAddressPayAmount(pay.amount);
      setLnAddressPayNote(pay.note);
      setLnAddressPayContactId(pay.contactId);
    },
    [],
  );
  const paymentOverlay = {
    dismissPaymentSending,
    formatDisplayedAmountParts,
    rememberFirstPayment,
    reportShortfall,
    setStatus,
    showPaidOverlay,
    showPaymentSending,
    t,
  };
  const {
    payContactWithCashuMessage,
    paySelectedContact,
    settleBankPaymentOffer,
  } = useContactPayments({
    ...paymentOverlay,
    cashuBalance,
    chat,
    contactPayMethod,
    contacts,
    currentNpub,
    currentNsec,
    getBankPaymentOfferForSettlement,
    isBankPaymentOfferCanceled,
    payAmount,
    pendingPaymentsKey,
    pushToast,
    respondToBankPaymentOfferWithGroupState,
    route,
    selectedContact,
    setLnAddressPay,
    walletOpRunning: cashuIsBusy,
  });
  const lightningPayments = useLightningPayments({
    ...paymentOverlay,
    contacts,
    lnAddressPayContactId,
    nostrPictureByNpub,
    routeKind: route.kind,
  });
  const paymentRequests = useCashuPaymentRequests({
    ...paymentOverlay,
    autoPayLimit: lightningInvoiceAutoPayLimit,
    chatMessages,
    contactPayBackToChatRef,
    contacts,
    currentNpub,
    defaultMintUrl,
    logPaymentEvent,
    nostrMessagesLatestRef,
    nostrMessagesLocal,
    nostrMessagesRecent,
    openScannedContactPendingNpubRef,
    payAmount,
    payContactWithCashuMessage,
    route,
    saveNpubContact,
    selectedChatContact,
    selectedContact,
    sendChatMessage,
    walletOpRunning: cashuIsBusy,
  });

  const closeLnurlWithdrawConfirmation = React.useCallback(() => {
    if (lnurlWithdrawIsBusy) return;
    setPendingLnurlWithdrawConfirmation(null);
  }, [lnurlWithdrawIsBusy]);

  const confirmLnurlWithdraw = React.useCallback(async () => {
    const pending = pendingLnurlWithdrawConfirmation;
    if (!pending || lnurlWithdrawIsBusy) return;

    const mintUrl = normalizeMintUrl(defaultMintUrl ?? MAIN_MINT_URL);
    if (!mintUrl) {
      setStatus(t("topupInvoiceFailed"));
      return;
    }

    setLnurlWithdrawIsBusy(true);
    try {
      setStatus(t("lnurlWithdrawPreparing"));
      const started = await startBackgroundTopup({
        amountSat: pending.amountSat,
        mint: mintUrl,
      });
      if (Result.isFailure(started)) {
        setStatus(
          `${t("errorPrefix")}: ${getUnknownErrorMessage(started.failure, "unknown")}`,
        );
        return;
      }
      await redeemLnurlWithdraw({
        callback: pending.callback,
        invoice: started.success.invoice,
        k1: pending.k1,
      });
      setPendingLnurlWithdrawConfirmation(null);
      setStatus(t("lnurlWithdrawPending"));
    } catch (error) {
      const message = getUnknownErrorMessage(error, t("lnurlWithdrawFailed"));
      setStatus(`${t("errorPrefix")}: ${message}`);
    } finally {
      setLnurlWithdrawIsBusy(false);
    }
  }, [
    defaultMintUrl,
    lnurlWithdrawIsBusy,
    pendingLnurlWithdrawConfirmation,
    setStatus,
    startBackgroundTopup,
    t,
  ]);

  const [walletWarningDismissed, setWalletWarningDismissed] = React.useState(
    () => safeLocalStorageGet(WALLET_WARNING_DISMISSED_STORAGE_KEY) === "1",
  );

  const walletWarningApplies =
    cashuBalance > WALLET_WARNING_BALANCE_THRESHOLD_SAT;

  const dismissWalletWarning = React.useCallback(() => {
    safeLocalStorageSet(WALLET_WARNING_DISMISSED_STORAGE_KEY, "1");
    setWalletWarningDismissed(true);
  }, []);

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

  const sendTokenMessage = useSendTokenMessage({
    appendLocalNostrMessage,
    currentNpub,
    logPayStep,
    nostrMessagesLocal,
    updateLocalNostrMessage,
  });
  const recurringScheduler = useRecurringPaymentsScheduler({
    contacts,
    envelopes: cashuEnvelopes,
    fiatRates,
    formatDisplayedAmountParts,
    hydrated: accountHydrated,
    logPaymentEvent,
    maybeShowPwaNotification,
    mintBalances: walletBalances.perMint,
    pushToast,
    repository: recurringPaymentsRepository,
    sendTokenMessage,
    showPaidOverlay,
    t,
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
    recoverEnvelopes: recurringScheduler.recoverEnvelopes,
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

  useResumeOnLaunchAndOnline(
    React.useMemo(() => {
      if (resumePendingCashuAutoswapClaims === null) return null;
      return () => {
        void resumePendingCashuAutoswapClaims().catch((error: unknown) => {
          console.warn("[linky][autoswap] resumePendingClaims failed", error);
        });
      };
    }, [resumePendingCashuAutoswapClaims]),
  );

  useMeltRecovery({
    pushToast,
    resumePendingCashuMelts,
    t,
    transactions,
  });

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

  const recurringDefaultMintUrl = normalizeMintUrl(
    defaultMintUrl ?? MAIN_MINT_URL,
  );
  const recurringPaymentsActions = useRecurringPaymentsActions({
    contacts,
    defaultMintUrl: recurringDefaultMintUrl,
    payWithCashuEnabled,
    pushToast,
    repository: recurringPaymentsRepository,
    runNow: recurringScheduler.runNow,
    t,
  });
  const recurringPaymentsContext = React.useMemo(
    () => ({
      ...recurringPaymentsActions,
      cancelDue: recurringScheduler.cancelDue,
      confirmDueNow: recurringScheduler.confirmDueNow,
      defaultMintUrl: recurringDefaultMintUrl,
      dueConfirmation: recurringScheduler.dueConfirmation,
      mintBalanceSat: (mintUrl: string) =>
        walletBalances.perMint.find((entry) => entry.mint === mintUrl)
          ?.amount ?? 0,
    }),
    [
      recurringDefaultMintUrl,
      recurringPaymentsActions,
      recurringScheduler.cancelDue,
      recurringScheduler.confirmDueNow,
      recurringScheduler.dueConfirmation,
      walletBalances.perMint,
    ],
  );

  const knownTransferTexts = React.useMemo(
    () => takenTokenTexts(walletTransfers, walletOperations),
    [walletOperations, walletTransfers],
  );
  const getCashuTokenMessageInfo = React.useCallback(
    (text: string) =>
      getCashuTokenMessageInfoBase(text, knownTransferTexts, allowTestMints),
    [allowTestMints, knownTransferTexts],
  );

  const recurringOrders = useRecurringPaymentOrders();
  useRecurringReminderSync({
    currentNsec,
    enabled: sendCashuToken !== null && meltCashuInvoice !== null,
    orders: recurringOrders,
  });

  return {
    ...lightningPayments,
    ...walletTokens,
    ...paymentRequests,
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
    closeLnurlWithdrawConfirmation,
    closePaymentMintMeltConfirmation,
    confirmLnurlWithdraw,
    confirmPaymentMintMelt,
    contactPayMethod,
    defaultMintDisplay,
    defaultMintUrl,
    dismissWalletWarning,
    estimateMintMove,
    getCashuTokenMessageInfo,
    getMintIconUrl,
    getMintRuntime,
    isCashuTokenKnownAny,
    isCashuTokenStored,
    lightningInvoiceAutoPayLimit,
    lnAddressPayAmount,
    lnAddressPayNote,
    lnurlWithdrawIsBusy,
    makeNip98AuthHeader,
    markMintIconFailed,
    meltLargestForeignMintToMainMint: meltToDefaultMint,
    mintInfoByUrl,
    moveMintFunds,
    paidOverlayDetails,
    paidOverlayIsOpen,
    paidOverlayPhase,
    paidOverlayTitle,
    paySelectedContact,
    payWithCashuEnabled,
    receiveMethod,
    pendingLnurlWithdrawConfirmation,
    pendingPaymentMintMeltConfirmation,
    probeLightningFee,
    refreshMintInfo,
    saveCashuFromText,
    setCashuDraft,
    setContactPayMethod,
    setLightningInvoiceAutoPayLimit,
    setLnAddressPayAmount,
    setLnAddressPayNote,
    setMintInfoAll,
    setAllowTestMints,
    setPayWithCashuEnabled,
    setReceiveMethod,
    setPendingLnurlWithdrawConfirmation,
    setTopupAmount,
    setTopupNote,
    settleBankPaymentOffer,
    showPaidOverlay,
    topupAmount,
    topupNote,
    topupInvoice,
    topupInvoiceCashuRequest,
    topupInvoiceError,
    topupInvoiceIsBusy,
    topupInvoiceQrPayload,
    topupMintUrl,
    walletWarningApplies,
    walletWarningDismissed,
  };
};
