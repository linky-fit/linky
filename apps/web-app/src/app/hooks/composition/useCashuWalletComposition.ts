import type { TextField } from "@linky-fit/ui";
import type { PushToastOptions } from "../../../hooks/useToasts";
import { transactionIdForOperation } from "@linky-fit/linksync";
import type { ReceiveMethod } from "../../../utils/receiveMethod";
import type { RestoreProgress } from "@linky-fit/linkshu";
import { useReclaimCashuTransfer } from "../cashu/useReclaimCashuTransfer";
import { paidOverlayContact } from "../../lib/paidOverlay";
import { useLatest } from "../../../hooks/useLatest";
import {
  CashuTokenText,
  ClientId,
  decodeNpub,
  encodeNprofile,
  identityFromNsec,
  OutboxRef,
  PaymentNoticeDraft,
  Pubkey,
  TokenMessageDraft,
} from "@linky-fit/linkstr";
import { useLinkstrCommands } from "@linky-fit/linkstr-react";
import { Cause, Result, Exit, Option, Schema } from "effect";
import React, { type ComponentRef, useMemo, useState } from "react";
import type { CashuOperationId, ContactId } from "../../../evolu";
import { navigateTo, useRouting } from "../../../hooks/useRouting";
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
import {
  isNpubCashDisabled,
  NPUB_CASH_SERVER_BASE_URL,
} from "../../../utils/npubCashServer";
import { planSendMint, type OperationId } from "@linky-fit/linkshu";
import {
  CashuOperationId as CashuOperationIdType,
  type TransactionsRepository,
} from "@linky-fit/linksync";
import {
  formatMintHost,
  MAIN_MINT_URL,
  normalizeMintUrl,
} from "../../../utils/mint";
import { normalizeNpubIdentifier } from "../../../utils/nostrNpub";
import { parseNpubCashProfileInfo } from "../../../utils/npubCashInfo";
import {
  getInitialLightningInvoiceAutoPayLimit,
  getInitialPayWithCashuEnabled,
  getInitialReceiveMethod,
  safeLocalStorageGet,
  safeLocalStorageSet,
} from "../../../utils/storage";
import { getUnknownErrorMessage } from "../../../utils/unknown";
import { makeLocalId } from "../../../utils/validation";
import { useCashuTokenChecks } from "../cashu/useCashuTokenChecks";
import { useNpubCashClaim } from "../cashu/useNpubCashClaim";
import { useRestoreMissingTokens } from "../cashu/useRestoreMissingTokens";
import { useSaveCashuFromText } from "../cashu/useSaveCashuFromText";
import { useDeferredReceiveRetry } from "../cashu/useDeferredReceiveRetry";
import { normalizePubkeyHex } from "../messages/contactIdentity";
import { useNpubCashMintSelection } from "../mint/useNpubCashMintSelection";
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
import { useWalletOps } from "../wallet/useWalletOps";
import { logPayStep } from "../../state/wallet/paymentLog";
import { useOwnerStorage, usePaymentLog } from "../wallet/useWalletStorage";
import { usePaidOverlayState } from "../usePaidOverlayState";
import { useProfileNpubCashEffects } from "../useProfileNpubCashEffects";
import { describeTaggedCashuError } from "../../lib/cashuStoredError";
import { isSpellingOf } from "../../lib/mintSpelling";
import {
  isIssuedTransfer,
  isOpenTransfer,
  isPendingDeferredReceive,
  takenTokenTexts,
} from "../../lib/cashuTransfers";
import {
  getCashuTokenMessageInfo as getCashuTokenMessageInfoBase,
  readCashuTokenMemo,
} from "../../lib/tokenMessageInfo";
import {
  useContactsMessagingComposition,
  type DisplayContact,
} from "./useContactsMessagingComposition";
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

const isPubkey = Schema.is(Pubkey);
const decodeCashuTokenText = Schema.decodeUnknownResult(CashuTokenText);

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
  const { enqueueOutbox, sendPaymentNotice } = useLinkstrCommands();
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
  const [cashuEmitAmount, setCashuEmitAmount] = useState("");
  const {
    runExclusive,
    runQueued,
    walletOpRunning: cashuIsBusy,
  } = useWalletOps();
  const [cashuBulkCheckIsBusy, setCashuBulkCheckIsBusy] = useState(false);
  const [tokensRestoreIsBusy, setTokensRestoreIsBusy] = useState(false);
  const [tokensRestoreProgress, setTokensRestoreProgress] =
    useState<RestoreProgress | null>(null);

  const [lnAddressPayAmount, setLnAddressPayAmount] = useState<string>("");
  const [lnAddressPayNote, setLnAddressPayNote] = useState<string>("");
  const [lnAddressPayContactId, setLnAddressPayContactId] =
    useState<ContactId | null>(null);

  const [pendingCashuTokenContactPickId, setPendingCashuTokenContactPickId] =
    useState<CashuOperationId | null>(null);

  const [
    pendingLnurlWithdrawConfirmation,
    setPendingLnurlWithdrawConfirmation,
  ] = useState<LnurlWithdrawPreview | null>(null);
  const [lnurlWithdrawIsBusy, setLnurlWithdrawIsBusy] = useState(false);

  const npubCashClaimInFlightRef = React.useRef(false);
  const npubCashMintSyncRef = React.useRef<string | null>(null);

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
    adoptPaidCashuQuote,
    allWalletProofs,
    cashuEnvelopes,
    cashuTransferLifecycle,
    checkAllCashuTokens,
    inspectCashuProofStates,
    checkCashuTransfer,
    fetchMintInfo,
    meltCashuInvoice,
    probeLightningFee,
    receiveCashuToken,
    restoreCashuTokens,
    reclaimCashuTokens,
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

  const { applyDefaultMintSelection, makeNip98AuthHeader } =
    useNpubCashMintSelection({
      currentNpub,
      currentNsec,
      // npub.cash keeps the stored choice; the test-mint fallback stays local.
      defaultMintChoice,
      npubCashMintSyncRef,
      pushToast,
      setDefaultMint,
      setStatus,
      t,
    });

  React.useEffect(() => {
    if (isNpubCashDisabled() || !currentNpub || !currentNsec) {
      setOwnedProfileLightningAddresses([]);
      setOwnedProfileLightningAddressesLoading(false);
      return;
    }

    setOwnedProfileLightningAddresses([]);
    setOwnedProfileLightningAddressesLoading(true);

    const controller = new AbortController();
    let cancelled = false;

    const loadOwnedLightningAddresses = async () => {
      try {
        const url = `${NPUB_CASH_SERVER_BASE_URL}/api/v1/info`;
        const auth = await makeNip98AuthHeader(url, "GET");
        const response = await fetch(url, {
          method: "GET",
          headers: { Authorization: auth },
          signal: controller.signal,
        });
        if (!response.ok) {
          if (!cancelled) {
            setOwnedProfileLightningAddresses([]);
            setOwnedProfileLightningAddressesLoading(false);
          }
          return;
        }

        const json = await response.json();
        if (cancelled) return;

        const info = parseNpubCashProfileInfo(json);
        setOwnedProfileLightningAddresses(info.ownedLightningAddresses);
        setOwnedProfileLightningAddressesLoading(false);
      } catch {
        if (cancelled) return;
        setOwnedProfileLightningAddresses([]);
        setOwnedProfileLightningAddressesLoading(false);
      }
    };

    void loadOwnedLightningAddresses();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    currentNpub,
    currentNsec,
    makeNip98AuthHeader,
    setOwnedProfileLightningAddresses,
    setOwnedProfileLightningAddressesLoading,
  ]);

  const { claimNpubCashOnce, claimNpubCashOnceLatestRef } = useNpubCashClaim({
    allowTestMints,
    adoptPaidCashuQuote,
    cashuIsBusy,
    copyText,
    currentNpub: nostrBootstrapReady ? currentNpub : null,
    currentNsec: nostrBootstrapReady ? currentNsec : null,
    formatDisplayedAmountParts,
    isMintDeleted,
    logPaymentEvent,
    makeLocalStorageKey,
    makeNip98AuthHeader,
    maybeShowPwaNotification,
    mintInfoByUrl,
    npubCashClaimInFlightRef,
    pushToast,
    receiveCashuToken,
    refreshMintInfo,
    rememberCashuTokenKnown,
    routeKind: route.kind,
    runQueued,
    setStatus,
    showPaidOverlay,
    t,
    touchMintInfo,
  });

  useProfileNpubCashEffects({
    claimNpubCashOnce,
    claimNpubCashOnceLatestRef,
    currentNpub,
    currentNsec,
    makeNip98AuthHeader,
    networkEnabled: nostrBootstrapReady,
    npubCashInfoInFlightRef,
    npubCashInfoLoadedAtMsRef,
    npubCashInfoLoadedForNpubRef,
    routeKind: route.kind,
    setIsProfileEditing,
    suggestDefaultMint,
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

  const {
    checkAllCashuTokensAndDeleteInvalid,
    checkAndRefreshCashuToken,
    deleteCashuToken,
  } = useCashuTokenChecks({
    cashuBulkCheckIsBusy,
    checkAllCashuTokens,
    checkCashuTransfer,
    forgetCashuTransfer: cashuTransferLifecycle?.forget ?? null,
    pushToast,
    setCashuBulkCheckIsBusy,
    runExclusive,
    setStatus,
    t,
  });

  // Issued-token claim detection over linkshu Validation.checkIssued: one
  // passive NUT-07 batch per mint of handed-out proofs, claimed transfers
  // closed by the package. A shared in-flight promise keeps the callers
  // (list-page mount, manual button, token-page 10s poll, 60s background
  // tick) from stacking redundant mint round-trips.
  const checkIssuedInFlightRef = React.useRef<Promise<{
    claimed: ReadonlyArray<{ amount: number; id: string }>;
  }> | null>(null);
  const checkIssuedCashuTokensAndDeleteClaimed = React.useCallback((): Promise<{
    claimed: ReadonlyArray<{ amount: number; id: string }>;
  }> => {
    if (cashuTransferLifecycle === null) {
      return Promise.resolve({ claimed: [] });
    }
    const inFlight = checkIssuedInFlightRef.current;
    if (inFlight) return inFlight;

    const run = cashuTransferLifecycle
      .checkIssuedClaims()
      .then((report) => ({
        claimed: report.claimed.map((entry) => ({
          amount: entry.amount,
          id: entry.operationId,
        })),
      }))
      .finally(() => {
        checkIssuedInFlightRef.current = null;
      });
    checkIssuedInFlightRef.current = run;
    return run;
  }, [cashuTransferLifecycle]);

  const checkSingleIssuedCashuTokenIsClaimed = React.useCallback(
    async (id: CashuOperationId): Promise<boolean> => {
      const outcome = await checkIssuedCashuTokensAndDeleteClaimed();
      return outcome.claimed.some((entry) => entry.id === id);
    },
    [checkIssuedCashuTokensAndDeleteClaimed],
  );

  // Background check for issued-token claims (issue #86). Runs once on
  // mount and every 60s thereafter while we have any issued tokens.
  // Detection removes the row, so the issued list cleans up even when the
  // user isn't sitting on #wallet/tokens; the ref keeps the 60s interval
  // from being torn down whenever the callback identity churns.
  const hasAnyIssuedTokensForBackgroundCheck =
    cashuOpenTransfers.some(isIssuedTransfer) ||
    walletProofs.some(
      (proof) => proof.state === "handedOut" || proof.state === "externalized",
    );
  const checkIssuedCashuTokensRef = useLatest(
    checkIssuedCashuTokensAndDeleteClaimed,
  );
  const formatDisplayedAmountTextRef = useLatest(formatDisplayedAmountText);
  const pushToastRef = useLatest(pushToast);
  const claimToastTRef = useLatest(t);
  React.useEffect(() => {
    if (!hasAnyIssuedTokensForBackgroundCheck) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      try {
        const outcome = await checkIssuedCashuTokensRef.current();
        if (cancelled) return;
        if (outcome.claimed.length === 0) return;
        // Background detection — surface a toast so the user knows the
        // issued token was redeemed even when they aren't on the QR
        // screen (the CashuTokenPage poll handles the in-page UX with a
        // checkmark overlay).
        const formatter = formatDisplayedAmountTextRef.current;
        const tt = claimToastTRef.current;
        for (const entry of outcome.claimed) {
          const message =
            entry.amount > 0
              ? tt("cashuTokenClaimedWithAmount").replace(
                  "{amount}",
                  formatter(entry.amount),
                )
              : tt("cashuTokenClaimed");
          pushToastRef.current(message);
        }
      } catch {
        // ignore — the helper already swallows mint-side errors.
      }
    };
    void tick();
    const intervalId = window.setInterval(() => {
      void tick();
    }, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [
    checkIssuedCashuTokensRef,
    claimToastTRef,
    formatDisplayedAmountTextRef,
    pushToastRef,
    hasAnyIssuedTokensForBackgroundCheck,
  ]);

  const reclaimCashuTransfer = useReclaimCashuTransfer({
    busy: cashuIsBusy || cashuBulkCheckIsBusy || tokensRestoreIsBusy,
    reclaim: cashuTransferLifecycle?.reclaim ?? null,
    runQueued,
    pushToast,
    t,
  });

  const returnCashuTokenToWallet = React.useCallback(
    async (id: CashuOperationId) => {
      if (cashuTransferLifecycle === null) {
        setStatus(`${t("errorPrefix")}: Cashu storage is not ready`);
        return;
      }
      const outcome = await cashuTransferLifecycle.returnToWallet(id);
      if (Result.isFailure(outcome)) {
        const message =
          describeTaggedCashuError(outcome.failure) ?? outcome.failure._tag;
        setStatus(`${t("errorPrefix")}: ${message}`);
        return;
      }

      setStatus(t("cashuReturnedToWallet"));
    },
    [cashuTransferLifecycle, setStatus, t],
  );

  const pendingCashuContactSend = React.useMemo(() => {
    if (!pendingCashuTokenContactPickId) return null;

    const transfer = walletTransfers.find(
      (candidate) =>
        String(candidate.id) === pendingCashuTokenContactPickId &&
        isIssuedTransfer(candidate),
    );
    if (!transfer) return null;

    return {
      amountSat: transfer.amount,
      tokenId: pendingCashuTokenContactPickId,
    };
  }, [pendingCashuTokenContactPickId, walletTransfers]);

  const cancelPendingCashuContactSend = React.useCallback(async () => {
    const tokenId = pendingCashuContactSend?.tokenId ?? null;
    setPendingCashuTokenContactPickId(null);
    if (!tokenId) return;

    await returnCashuTokenToWallet(tokenId);
  }, [pendingCashuContactSend, returnCashuTokenToWallet]);

  const runCashuTokenTransition = React.useCallback(
    async (
      id: CashuOperationId,
      transition: "markExternalized" | "markIssued",
    ): Promise<boolean> => {
      if (cashuTransferLifecycle === null) {
        setStatus(`${t("errorPrefix")}: Cashu storage is not ready`);
        return false;
      }
      const outcome = await cashuTransferLifecycle[transition](id);
      if (Result.isFailure(outcome)) {
        const message =
          describeTaggedCashuError(outcome.failure) ?? outcome.failure._tag;
        setStatus(`${t("errorPrefix")}: ${message}`);
        return false;
      }
      return true;
    },
    [cashuTransferLifecycle, setStatus, t],
  );

  const markCashuTokenIssued = React.useCallback(
    (id: CashuOperationId): Promise<boolean> =>
      runCashuTokenTransition(id, "markIssued"),
    [runCashuTokenTransition],
  );

  const markCashuTokenExternalized = React.useCallback(
    (id: CashuOperationId): Promise<boolean> =>
      runCashuTokenTransition(id, "markExternalized"),
    [runCashuTokenTransition],
  );

  /** Closes a transfer the user is done with; never a refund. */
  const forgetCashuTransfer = React.useCallback(
    async (id: CashuOperationId): Promise<boolean> => {
      if (cashuTransferLifecycle === null) {
        setStatus(`${t("errorPrefix")}: Cashu storage is not ready`);
        return false;
      }
      try {
        const outcome = await cashuTransferLifecycle.forget(id);
        if (Result.isFailure(outcome)) {
          setStatus(
            `${t("errorPrefix")}: ${describeTaggedCashuError(outcome.failure) ?? outcome.failure._tag}`,
          );
          return false;
        }
      } catch (error) {
        setStatus(
          `${t("errorPrefix")}: ${getUnknownErrorMessage(error, "unknown")}`,
        );
        return false;
      }
      return true;
    },
    [cashuTransferLifecycle, setStatus, t],
  );

  /** Gives up on a token waiting for its mint; lost unless its text was kept. */
  const discardCashuDeferredReceive = React.useCallback(
    async (id: OperationId): Promise<void> => {
      if (cashuTransferLifecycle === null) {
        setStatus(`${t("errorPrefix")}: Cashu storage is not ready`);
        return;
      }
      try {
        const outcome = await cashuTransferLifecycle.forget(id);
        if (Result.isFailure(outcome)) {
          setStatus(
            // A retry pass handed the token to its receive first.
            outcome.failure._tag === "InvalidTransferTransition"
              ? t("cashuDeferredAlreadyReceiving")
              : `${t("errorPrefix")}: ${describeTaggedCashuError(outcome.failure) ?? outcome.failure._tag}`,
          );
          return;
        }
      } catch (error) {
        setStatus(
          `${t("errorPrefix")}: ${getUnknownErrorMessage(error, "unknown")}`,
        );
        return;
      }
      setStatus(t("cashuDeferredReceiveDiscarded"));
    },
    [cashuTransferLifecycle, setStatus, t],
  );

  const startSendCashuTokenToContact = React.useCallback(
    async (id: CashuOperationId) => {
      setPendingCashuTokenContactPickId(id);
      setStatus(t("cashuSelectContactToSend"));
      navigateTo({ route: "contacts" });
    },
    [setStatus, t],
  );

  const sendCashuTokenToContact = React.useCallback(
    async (contact: DisplayContact, tokenId: CashuOperationId) => {
      setPendingCashuTokenContactPickId(null);

      const transfer = walletTransfers.find(
        (candidate) =>
          String(candidate.id) === tokenId && isIssuedTransfer(candidate),
      );
      const tokenText = transfer?.tokenText ?? "";

      if (!transfer || !tokenText) {
        setStatus(t("cashuInvalid"));
        return;
      }
      const tokenMeta = {
        amount: transfer.amount,
        mint: transfer.mint,
        unit: transfer.unit,
      };

      const contactId = (contact.id ?? "").trim();
      if (!contactId) {
        setStatus(t("contactNotFound"));
        return;
      }

      if (!currentNsec) {
        setStatus(t("profileMissingNpub"));
        return;
      }

      let contactPubHex = normalizePubkeyHex(contact.unknownPubkeyHex);
      const contactNpub = normalizeNpubIdentifier(contact.npub ?? "");

      if (!contactPubHex && contactNpub) {
        contactPubHex = decodeNpub(contactNpub);
      }

      if (!contactPubHex || !isPubkey(contactPubHex)) {
        setStatus(t("chatMissingContactNpub"));
        return;
      }

      const transactionNote = readCashuTokenMemo(tokenText);
      const logIssuedTokenSendTransaction = (phase: "complete" | "publish") => {
        logPaymentEvent({
          amount: tokenMeta.amount,
          contactId,
          details: {
            usedInputTokens: [tokenText],
          },
          direction: "out",
          error: null,
          fee: null,
          method: "cashu_chat",
          mint: tokenMeta.mint,
          note: transactionNote,
          paymentType: "contact",
          phase,
          status: "ok",
          transactionId: transactionIdForOperation(tokenId),
          unit: tokenMeta.unit,
        });
      };

      try {
        const identity = identityFromNsec(currentNsec);
        if (!identity) throw new Error("invalid nsec");
        const myPubHex = identity.pubkey;
        const token = decodeCashuTokenText(tokenText);
        if (Result.isFailure(token)) {
          throw new Error("invalid cashu token");
        }
        const clientId = ClientId.make(makeLocalId());
        const pendingId = appendLocalNostrMessage({
          contactId,
          direction: "out",
          content: tokenText,
          wrapId: `pending:${clientId}`,
          rumorId: null,
          pubkey: myPubHex,
          createdAtSec: Math.ceil(Date.now() / 1e3),
          status: "pending",
          clientId,
        }).id;
        if (!pendingId) throw new Error("failed to persist message");

        const closed = await forgetCashuTransfer(tokenId);
        if (!closed) {
          return;
        }

        navigateTo({ route: "chat", id: contactId });

        const draft = new TokenMessageDraft({
          to: contactPubHex,
          token: token.success,
          clientId,
        });
        const exit = await enqueueOutbox({
          op: { _tag: "chat.token", draft },
          ref: OutboxRef.make(`message:${pendingId}`),
        });

        if (Exit.isFailure(exit)) {
          setStatus(`${t("errorPrefix")}: ${Cause.pretty(exit.cause)}`);
          return;
        }

        updateLocalNostrMessage(pendingId, {
          createdAtSec: exit.value.sentAt,
          rumorId: exit.value.rumorId,
        });

        const isOffline =
          typeof navigator !== "undefined" && navigator.onLine === false;
        if (isOffline) {
          logIssuedTokenSendTransaction("publish");
          setStatus(t("chatQueued"));
          return;
        }

        const noticeClientId = ClientId.make(makeLocalId());
        try {
          const noticeExit = await sendPaymentNotice(
            new PaymentNoticeDraft({
              to: contactPubHex,
              clientId: noticeClientId,
            }),
          );
          const failure = Exit.isFailure(noticeExit)
            ? Cause.findErrorOption(noticeExit.cause)
            : Option.none();
          logPayStep("payment-notice-publish", {
            anySuccess: Exit.isSuccess(noticeExit),
            clientId: noticeClientId,
            error: Option.isSome(failure) ? failure.value._tag : null,
            wrapId: Exit.isSuccess(noticeExit)
              ? noticeExit.value.recipientCopy.wrapId
              : null,
          });
        } catch (error) {
          logPayStep("payment-notice-publish", {
            anySuccess: false,
            clientId: noticeClientId,
            error: getUnknownErrorMessage(error, "publish failed"),
            wrapId: null,
          });
        }

        logIssuedTokenSendTransaction("complete");
      } catch (error) {
        setStatus(`${t("errorPrefix")}: ${String(error ?? "unknown")}`);
      }
    },
    [
      appendLocalNostrMessage,
      currentNsec,
      enqueueOutbox,
      forgetCashuTransfer,
      logPaymentEvent,
      sendPaymentNotice,
      setStatus,
      t,
      updateLocalNostrMessage,
      walletTransfers,
    ],
  );

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

  const recoverTokens = useRestoreMissingTokens({
    allowTestMints,
    cashuIsBusy,
    walletMints,
    defaultMintUrl,
    isMintDeleted,
    logPaymentEvent,
    mintInfoDeduped,
    pushToast,
    readSeenMintsFromStorage,
    recoverEnvelopes: recurringScheduler.recoverEnvelopes,
    rememberSeenMint,
    restoreCashuTokens,
    reclaimCashuTokens,
    runQueued,
    setTokensRestoreIsBusy,
    setTokensRestoreProgress,
    t,
    tokensRestoreIsBusy,
  });

  const restoreMissingTokens = React.useCallback(
    () => recoverTokens("missing"),
    [recoverTokens],
  );
  const reclaimHandedOutTokens = React.useCallback(
    () => recoverTokens("reclaim"),
    [recoverTokens],
  );
  const restoreAndReclaimAllTokens = React.useCallback(
    () => recoverTokens("all"),
    [recoverTokens],
  );

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

  const emitCashuToken = React.useCallback(
    async (options?: { note?: string | null }) => {
      const note = (options?.note ?? "").trim() || null;
      const amountSat = Number.parseInt(cashuEmitAmount.trim(), 10);
      if (!Number.isFinite(amountSat) || amountSat <= 0) {
        setStatus(t("payInvalidAmount"));
        return;
      }

      if (cashuIsBusy) return;
      if (cashuBalance < amountSat) {
        setStatus(t("payInsufficient"));
        return;
      }
      if (sendCashuToken === null) {
        setStatus(`${t("errorPrefix")}: Cashu storage is not ready`);
        return;
      }

      const logEmitFailure = (error: string, mint: string | null): void => {
        logPaymentEvent({
          direction: "out",
          status: "error",
          amount: amountSat,
          fee: null,
          mint,
          unit: "sat",
          error,
          contactId: null,
          method: "unknown",
          phase: "swap",
        });
      };

      await runExclusive(async () => {
        setStatus(t("cashuEmitting"));

        try {
          const mint = planSendMint({
            balances: walletBalances.perMint,
            isPreferredMint: isSpellingOf(defaultMintUrl),
            amount: amountSat,
          });
          if (mint === null) {
            setStatus(t("payInsufficient"));
            return;
          }

          const outcome = await sendCashuToken({
            amountSat,
            memo: note,
            mint,
            produceAs: "issued",
          });
          if (Result.isFailure(outcome)) {
            const sendError = outcome.failure;
            const errorMessage =
              describeTaggedCashuError(sendError) ?? sendError._tag;
            logEmitFailure(errorMessage, mint);
            setStatus(
              sendError._tag === "InsufficientFunds"
                ? t("payInsufficient")
                : `${t("payFailed")}: ${errorMessage}`,
            );
            return;
          }

          const receipt = outcome.success;
          logPaymentEvent({
            direction: "out",
            status: "ok",
            transactionId: transactionIdForOperation(receipt.operationId),
            amount: receipt.amount,
            details: {
              issuedToken: receipt.tokenText,
            },
            fee: null,
            mint: receipt.mint,
            note,
            unit: receipt.unit,
            error: null,
            contactId: null,
            method: "unknown",
            phase: "swap",
          });

          setCashuEmitAmount("");
          setStatus(null);
          const routeId = CashuOperationIdType.fromUnknown(receipt.operationId);
          navigateTo(
            routeId.ok
              ? { route: "cashuToken", id: routeId.value }
              : { route: "cashuTokens" },
          );
        } catch (error) {
          const errorMessage = getUnknownErrorMessage(error, "unknown");
          logEmitFailure(errorMessage, null);
          setStatus(`${t("payFailed")}: ${errorMessage}`);
        }
      });
    },
    [
      cashuBalance,
      cashuEmitAmount,
      cashuIsBusy,
      defaultMintUrl,
      logPaymentEvent,
      runExclusive,
      sendCashuToken,
      setCashuEmitAmount,
      setStatus,
      t,
      walletBalances.perMint,
    ],
  );

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
    ...paymentRequests,
    recurringPaymentsContext,
    reclaimCashuTransfer,
    cashuTransferLifecycle,
    // Backup export and the Nostr bootstrap snapshot need every proof,
    // including hidden test-mint proofs; keep this unfiltered.
    allCashuProofs: allWalletProofs,
    allowTestMints,
    applyDefaultMintSelection,
    canPayWithCashu,
    cancelPendingCashuContactSend,
    cashuBalance,
    cashuBalanceAfterMelt,
    cashuBulkCheckIsBusy,
    cashuDraft,
    cashuDraftRef,
    cashuEmitAmount,
    cashuHasMultipleAcceptedMints,
    cashuIsBusy,
    cashuMeltToMainMintButtonLabel,
    cashuOpenTransfers,
    cashuDeferredReceives: walletDeferredReceives,
    discardCashuDeferredReceive,
    cashuProofs: walletProofs,
    cashuOperations: walletOperations,
    cashuTokensHydratedRef,
    cashuTotalBalance,
    cashuTransfers: walletTransfers,
    checkAllCashuTokensAndDeleteInvalid,
    inspectCashuProofStates,
    checkAndRefreshCashuToken,
    checkIssuedCashuTokensAndDeleteClaimed,
    checkSingleIssuedCashuTokenIsClaimed,
    closeLnurlWithdrawConfirmation,
    closePaymentMintMeltConfirmation,
    confirmLnurlWithdraw,
    confirmPaymentMintMelt,
    contactPayMethod,
    defaultMintDisplay,
    defaultMintUrl,
    dismissWalletWarning,
    emitCashuToken,
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
    markCashuTokenExternalized,
    markCashuTokenIssued,
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
    pendingCashuContactSend,
    pendingCashuTokenContactPickId,
    receiveMethod,
    pendingLnurlWithdrawConfirmation,
    pendingPaymentMintMeltConfirmation,
    probeLightningFee,
    refreshMintInfo,
    deleteCashuToken,
    restoreMissingTokens,
    reclaimHandedOutTokens,
    restoreAndReclaimAllTokens,
    returnCashuTokenToWallet,
    saveCashuFromText,
    sendCashuTokenToContact,
    setCashuDraft,
    setCashuEmitAmount,
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
    startSendCashuTokenToContact,
    tokensRestoreIsBusy,
    tokensRestoreProgress,
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
