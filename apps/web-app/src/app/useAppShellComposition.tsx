import { createContactNameFormatter } from "../utils/contactName";
import { useMemoizedRouteBuilder } from "./hooks/composition/useMemoizedRouteBundle";
import { ContactId as ContactIdType } from "@linky-fit/linksync";
import { useAtom } from "@linky-fit/linkstr-react";
import React, { useMemo, useState } from "react";
import type { MessageContactsGroupAssignment } from "../components/ChatMessage";
import { ContactCard } from "../components/ContactCard";
import {
  useEvoluDatabaseInfoState,
  useEvoluLastError,
  useEvoluServersManager,
  useWipeEvoluStorage,
  type ContactId,
} from "../evolu";
import { useRouting } from "../hooks/useRouting";
import { useToasts } from "../hooks/useToasts";
import { reportAppLog } from "../devtools/inspector/appLog";
import {
  requestDeviceMotionPermission,
  requiresDeviceMotionPermission,
} from "../platform/deviceMotion";
import { shouldRenderNativeNfcWritePrompt } from "../platform/nativeBridge";
import {
  triggerPasswordManagerSeedSave,
  type PasswordManagerSaveResult,
} from "../platform/passwordManager";
import {
  CONTACTS_ONBOARDING_HAS_BACKUPED_KEYS_STORAGE_KEY,
  FEEDBACK_CONTACT_NPUB,
} from "../utils/constants";
import type { DisplayCurrency } from "../utils/displayAmounts";
import { normalizeNpubIdentifier } from "../utils/nostrNpub";
import {
  getInitialSeenReceiptsEnabledAtSec,
  getInitialShowProfileQrOnTiltEnabled,
  safeLocalStorageGet,
  safeLocalStorageSet,
} from "../utils/storage";
import { useCashuWalletComposition } from "./hooks/composition/useCashuWalletComposition";
import { logPayStep } from "./state/wallet/paymentLog";
import {
  useContactsMessagingComposition,
  type DisplayContact,
} from "./hooks/composition/useContactsMessagingComposition";
import { useIdentityOwnersComposition } from "./hooks/composition/useIdentityOwnersComposition";
import { buildMoneyRouteProps } from "./routes/props/buildMoneyRouteProps";
import { useProfileComposition } from "./hooks/composition/useProfileComposition";
import { buildPeopleRouteProps } from "./routes/props/buildPeopleRouteProps";
import { useRoutingViewComposition } from "./hooks/composition/useRoutingViewComposition";
import { useScanNativeComposition } from "./hooks/composition/useScanNativeComposition";
import { useSystemSettingsComposition } from "./hooks/composition/useSystemSettingsComposition";
import { useMainMenuState } from "./hooks/layout/useMainMenuState";
import { useNativeBackHandler } from "./hooks/layout/useNativeBackHandler";
import { useChatMessageEffects } from "./hooks/messages/useChatMessageEffects";
import { useAppDataTransfer } from "./hooks/useAppDataTransfer";
import { useAppLanguage } from "./hooks/useAppLanguage";
import { useAllowedDisplayCurrencies } from "./hooks/useAllowedDisplayCurrencies";
import { useAppPreferences } from "./hooks/useAppPreferences";
import { useTopDownTilt } from "./hooks/useTopDownTilt";
import { useFiatRatesSync } from "./hooks/useFiatRates";
import { useCopyText, useDisplayAmounts, useSetStatus } from "./hooks/shell";
import { displayPrefsAtom } from "./state/shell/displayPrefs";
import { hiddenTransactionsShownAtom } from "./state/shell/topbar";
import { useLnurlAuth } from "./hooks/useLnurlAuth";
import { useSiteLogin } from "./hooks/useSiteLogin";
import {
  useContactsRepository,
  useConversationsRepository,
  useSetting,
  useSettingsRepository,
  useShardRotation,
  useShardSummaries,
  useSyncOwnerIds,
  useTransactionsRepository,
} from "./hooks/useLinksync";
import { useStatusToasts } from "./hooks/useStatusToasts";
import { useStoragePersistRequestEffect } from "./hooks/useStoragePersistRequestEffect";
import { runWrite } from "./lib/storeWrite";
import { parsePrivateImageMessage } from "./lib/privateImageMessage";
import { showPwaNotification } from "./lib/pwaNotifications";
import {
  buildTopbar,
  buildTopbarRight,
  buildTopbarTitle,
  resolveBackAction,
} from "./lib/topbarConfig";
import { getDesktopActiveContactId } from "./routes/desktopRouteSection";
import type { ContactRowLike } from "./types/appTypes";
import { nowSeconds } from "../utils/time";

const parseContactId = (value: unknown): ContactId | null => {
  const result = ContactIdType.fromUnknown(value);
  return result.ok ? result.value : null;
};

interface UseAppShellCompositionParams {
  currentNsec: string;
}

export const useAppShellComposition = ({
  currentNsec,
}: UseAppShellCompositionParams) => {
  const route = useRouting();
  const { dismissToast, toasts, pushToast } = useToasts();
  const { lang, setLang, t } = useAppLanguage();
  const {
    answerPendingIdentitySwitch,
    canSwitchToDefaultIdentity,
    appOwnerId,
    appOwnerIdRef,
    currentNpub,
    isSeedLogin,
    logoutArmed,
    pendingIdentitySwitch,
    requestLogout,
    requestPasteNostrKeys,
    seedMnemonic,
    slip39Seed,
    switchToDefaultIdentity,
    syncedNostrIdentityMatchesLocal,
  } = useIdentityOwnersComposition({
    currentNsec,
    lang,
    pushToast,
    t,
  });

  const contactsRepository = useContactsRepository();
  const conversationsRepository = useConversationsRepository();
  const settingsRepository = useSettingsRepository();
  const transactions = useTransactionsRepository();
  const evoluShards = useShardSummaries();
  const evoluSyncOwnerIds = useSyncOwnerIds();
  const shardRotation = useShardRotation();

  const evoluServers = useEvoluServersManager();
  const evoluServerUrls = evoluServers.configuredUrls;
  const evoluActiveServerUrls = evoluServers.activeUrls;
  const evoluServerStatusByUrl = evoluServers.statusByUrl;
  const evoluServersReloadRequired = evoluServers.reloadRequired;
  const saveEvoluServerUrls = evoluServers.setServerUrls;
  const isEvoluServerOffline = evoluServers.isOffline;
  const isEvoluServerRecommended = evoluServers.isRecommended;
  const setEvoluServerOffline = evoluServers.setServerOffline;

  const [newEvoluServerUrl, setNewEvoluServerUrl] = useState("");

  const setStatus = useSetStatus();
  const importDataFileInputRef = React.useRef<HTMLInputElement | null>(null);

  const { allowedDisplayCurrencies, toggleAllowedDisplayCurrency } =
    useAllowedDisplayCurrencies();
  const [{ decimalAmountInputEnabled, displayCurrency }, setDisplayPrefs] =
    useAtom(displayPrefsAtom);
  const setDisplayCurrency = React.useCallback(
    (currency: DisplayCurrency) =>
      setDisplayPrefs((prefs) => ({ ...prefs, displayCurrency: currency })),
    [setDisplayPrefs],
  );
  const [seenReceiptsEnabledAtSec, setSeenReceiptsEnabledAtSec] = useState<
    number | null
  >(getInitialSeenReceiptsEnabledAtSec);
  const [showProfileQrOnTiltEnabled, setShowProfileQrOnTiltEnabled] =
    useState<boolean>(
      () =>
        !requiresDeviceMotionPermission() &&
        getInitialShowProfileQrOnTiltEnabled(),
    );
  const motionPermissionPendingRef = React.useRef(false);
  const [profileShareOverlayIsOpen, setProfileShareOverlayIsOpen] =
    useState(false);

  React.useEffect(() => {
    if (allowedDisplayCurrencies.includes(displayCurrency)) return;
    setDisplayCurrency(allowedDisplayCurrencies[0] ?? "sat");
  }, [allowedDisplayCurrencies, displayCurrency, setDisplayCurrency]);

  const setDisplayCurrencyIfAllowed = React.useCallback(
    (currency: DisplayCurrency) => {
      if (!allowedDisplayCurrencies.includes(currency)) return;
      setDisplayCurrency(currency);
    },
    [allowedDisplayCurrencies, setDisplayCurrency],
  );

  const toggleDecimalAmountInput = React.useCallback(() => {
    setDisplayPrefs((prefs) => ({
      ...prefs,
      decimalAmountInputEnabled: !prefs.decimalAmountInputEnabled,
    }));
  }, [setDisplayPrefs]);

  const toggleShowProfileQrOnTilt = React.useCallback(async () => {
    if (motionPermissionPendingRef.current) return;
    motionPermissionPendingRef.current = true;
    const enabled = showProfileQrOnTiltEnabled
      ? false
      : await requestDeviceMotionPermission();
    setShowProfileQrOnTiltEnabled(enabled);
    motionPermissionPendingRef.current = false;
    reportAppLog({
      tag: "profileShare.tiltSettingChanged",
      summary: enabled
        ? "Tilt to show profile enabled"
        : "Tilt to show profile disabled",
      payload: {
        enabled,
        permissionGranted: showProfileQrOnTiltEnabled ? null : enabled,
      },
    });
  }, [showProfileQrOnTiltEnabled]);

  const closeProfileShareOverlay = React.useCallback(() => {
    setProfileShareOverlayIsOpen(false);
  }, []);

  // Enabling records the baseline: only messages newer than it are ever
  // reported as seen, so pre-enable history stays unreported.
  const toggleSendReadReceipts = React.useCallback(() => {
    setSeenReceiptsEnabledAtSec((current) =>
      current === null ? nowSeconds() : null,
    );
  }, []);

  useFiatRatesSync();
  const {
    displayUnit,
    fiatRates,
    formatDisplayedAmountParts,
    formatDisplayedAmountText,
  } = useDisplayAmounts();

  const evoluLastError = useEvoluLastError({ logToConsole: true });
  const wipeEvoluStorageImpl = useWipeEvoluStorage();
  const evoluHasError = Boolean(evoluLastError);

  React.useEffect(() => {
    if (!evoluLastError) return;
    const message = String(evoluLastError ?? "");
    if (!message.includes("WebAssembly.Memory(): could not allocate memory")) {
      return;
    }
    const key = "linky.evolu.autoWipeOnWasmOom.v1";
    const alreadyTried = (safeLocalStorageGet(key) ?? "").trim() === "1";
    if (alreadyTried) return;
    safeLocalStorageSet(key, "1");
    // One-shot WASM-OOM recovery is the only automatic wipe of local Evolu data.
    try {
      wipeEvoluStorageImpl();
    } catch {
      // ignore
    }
  }, [evoluLastError, wipeEvoluStorageImpl]);

  const evoluDbInfo = useEvoluDatabaseInfoState({
    enabled:
      route.kind === "evoluServers" ||
      route.kind === "evoluServer" ||
      route.kind === "evoluServerNew" ||
      route.kind === "evoluData" ||
      route.kind === "evoluCurrentData" ||
      route.kind === "evoluHistoryData",
  });

  const evoluConnectedServerCount = useMemo(() => {
    return evoluActiveServerUrls.reduce((sum, url) => {
      return sum + (evoluServerStatusByUrl[url] === "connected" ? 1 : 0);
    }, 0);
  }, [evoluActiveServerUrls, evoluServerStatusByUrl]);

  const evoluOverallStatus = useMemo(() => {
    if (!appOwnerId) return "disconnected" as const;
    if (evoluHasError) return "disconnected" as const;
    if (evoluActiveServerUrls.length === 0) return "disconnected" as const;
    const states = evoluActiveServerUrls.map(
      (url) => evoluServerStatusByUrl[url] ?? "checking",
    );
    if (states.some((s) => s === "connected")) return "connected" as const;
    if (states.some((s) => s === "checking")) return "checking" as const;
    return "disconnected" as const;
  }, [
    appOwnerId,
    evoluActiveServerUrls,
    evoluHasError,
    evoluServerStatusByUrl,
  ]);

  const [evoluWipeStorageIsBusy, setEvoluWipeStorageIsBusy] =
    useState<boolean>(false);

  const wipeEvoluStorage = React.useCallback(async () => {
    // Evolu keeps quota errors after another relay converges; successful probes
    // and dismissed warnings are not proof of recovery.
    if (evoluLastError?.type === "ProtocolQuotaError") {
      pushToast(t("evoluQuotaRecoveryHint"));
      return;
    }
    if (evoluWipeStorageIsBusy) return;
    setEvoluWipeStorageIsBusy(true);

    try {
      wipeEvoluStorageImpl();
    } catch {
      pushToast(t("evoluWipeStorageFailed"));
    } finally {
      setEvoluWipeStorageIsBusy(false);
    }
  }, [
    evoluLastError,
    evoluWipeStorageIsBusy,
    pushToast,
    t,
    wipeEvoluStorageImpl,
  ]);

  const [contactPaymentIntent, setContactPaymentIntent] = useState<
    "pay" | "request"
  >("pay");
  const [payAmount, setPayAmount] = useState<string>("");
  const contactsOnboardingDismissedSynced =
    useSetting("onboardingTutorial") === "dismissed";
  const persistContactsOnboardingDismissed = React.useCallback(() => {
    if (contactsOnboardingDismissedSynced) return;
    void runWrite(settingsRepository.set("onboardingTutorial", "dismissed"));
  }, [contactsOnboardingDismissedSynced, settingsRepository]);

  useStoragePersistRequestEffect({ refreshKey: t });

  const maybeShowPwaNotification = React.useCallback(
    async (title: string, body: string, tag?: string) => {
      await showPwaNotification({
        appTitle: t("appTitle"),
        body,
        title,
        ...(tag === undefined ? {} : { tag }),
      });
    },
    [t],
  );

  const contactPayBackToChatRef = React.useRef<ContactId | null>(null);

  useStatusToasts();

  const copyText = useCopyText();

  const {
    saveNpubContact,
    activeGroup,
    addNewContactFromIdentifier,
    addNewContactFromSearchResult,
    addNpubMessageContacts,
    addUnknownContactFromChat,
    appendLocalNostrMessage,
    assignPendingContactsToGroup,
    autoAcceptedChatMessageIdsRef,
    closeContactsGroupAssignment,
    pendingContactsGroupAssignment,
    activeBankPaymentOfferContacts,
    bankPaymentOfferContacts,
    bankPaymentOfferMessages,
    proxyPaymentPayerContacts,
    getBankPaymentOfferForSettlement,
    bankPaymentOfferRecipientCount,
    bankPaymentOfferStaggerDelaySec,
    blockArchivedContact,
    blockUnknownContactFromChat,
    addChatAttachments,
    canSaveNewRelay,
    chatAttachments,
    chatDidInitialScrollForContactRef,
    chatDraft,
    chatForceScrollToBottomRef,
    chatLastMessageCountRef,
    chatMessageElByIdRef,
    chatMessages,
    chatMessagesRef,
    chatMessagesWithBankPaymentOffers,
    chatOwnPubkeyHex,
    chatScrollTargetIdRef,
    chatSendIsBusy,
    closeContactDetail,
    contactEditsSavable,
    contactFilterOptions,
    contactSuggestions,
    contacts,
    contactsLatestRef,
    contactsOnboardingHasBackedUpKeys,
    contactsOnboardingHasPaid,
    contactsOnboardingHasSentMessage,
    contactsFilterOpen,
    contactsSearch,
    contactsSearchInputRef,
    dedupeContacts,
    dedupeContactsIsBusy,
    dispatchInboxEvent,
    displayContactById,
    editContext,
    editingId,
    enqueuePendingPayment,
    form,
    getNpubMessageContactInfo,
    groupNames,
    handleSaveContact,
    isBankPaymentOfferCanceled,
    isRecommendedRelay,
    isSavingContact,
    lastMessageByContactId,
    mentionContacts,
    newRelayUrl,
    nostrBootstrapReady,
    nostrMessagesLatestRef,
    nostrMessagesLocal,
    nostrMessagesRecent,
    nostrMetadataByNpub,
    nostrPictureByNpub,
    nostrStatusByNpub,
    onCancelEdit,
    onCancelReply,
    onCopyChatMessage,
    onDeclineChatPaymentRequest,
    onEditChatMessage,
    onReactToChatMessage,
    onReplyToChatMessage,
    openContactDetail,
    openContactPay,
    openFeedbackContact,
    openNewContactPage,
    openNpubMessageContact,
    openScannedContactPendingNpubRef,
    pendingPaymentsKey,
    pendingRelayDeleteUrl,
    reactionsByMessageId,
    relayUrls,
    replyContext,
    requestBankPaymentOffer,
    archiveCurrentContact,
    requestDeleteSelectedRelay,
    resetEditedContactFieldFromNostr,
    respondToBankPaymentOfferWithGroupState,
    restoreArchivedContact,
    saveNewRelay,
    searchNewContact,
    selectedChatContact,
    selectedContact,
    selectedContactPublicProfile,
    selectedRelayUrl,
    sendChatImage,
    sendChatMessage,
    sendChatOrEditMessage,
    removeChatAttachment,
    setActiveGroup,
    setChatDraft,
    setContactNewPrefill,
    setContactsOnboardingHasBackedUpKeys,
    setContactsOnboardingHasPaid,
    setContactsSearch,
    setForm,
    setNewRelayUrl,
    statusFilterCurrencies,
    toggleContactsFilter,
    ungroupedCount,
    unreadByContactId,
    updateLocalNostrMessage,
    visibleContacts,
  } = useContactsMessagingComposition({
    appOwnerId,
    contactPayBackToChatRef,
    contactsRepository,
    conversationsRepository,
    copyText,
    currentNpub,
    currentNsec,
    formatDisplayedAmountText,
    isSeedLogin,
    lang,
    logPayStep,
    maybeShowPwaNotification,
    pushToast,
    route,
    seenReceiptsEnabledAtSec,
    setContactPaymentIntent,
    setPayAmount,
    setStatus,
    syncedNostrIdentityMatchesLocal,
    t,
  });

  const {
    shuffleProfileAvatar,
    derivedProfile,
    effectiveMyLightningAddress,
    effectiveProfileName,
    effectiveProfilePicture,
    isProfileEditing,
    myProfileStatus,
    npubCashInfoInFlightRef,
    npubCashInfoLoadedAtMsRef,
    npubCashInfoLoadedForNpubRef,
    onPickProfilePhoto,
    onProfilePhotoError,
    onProfilePhotoSelected,
    openProfileQr,
    ownedProfileLightningAddresses,
    profileCustomPictureUrl,
    profileEditInitialRef,
    profileEditLnAddress,
    profileEditName,
    profileEditPicture,
    profileEditStatus,
    profileEditsSavable,
    profileIsSaving,
    profilePhotoInputRef,
    profileSelectedPictureKind,
    profileStatusCurrencies,
    profileStatusIsSaving,
    saveClaimedLightningAddress,
    saveProfileEdits,
    selectedProfileStatusCurrencies,
    setIsProfileEditing,
    setOwnedProfileLightningAddresses,
    setOwnedProfileLightningAddressesLoading,
    setProfileEditLnAddress,
    setProfileEditName,
    setProfileEditStatus,
    toggleProfileEditing,
    toggleProfileStatusCurrency,
    unregisteredOwnLightningAddress,
  } = useProfileComposition({
    currentNpub,
    currentNsec,
    lang,
    nostrMetadataByNpub,
    nostrPictureByNpub,
    nostrStatusByNpub,
    nostrBootstrapReady,
    route,
    setStatus,
    t,
  });

  const {
    allCashuProofs,
    allowTestMints,
    applyDefaultMintSelection,
    cancelPendingCashuContactSend,
    cashuBalance,
    cashuBalanceAfterMelt,
    cashuIsBusy,
    cashuDeferredReceives,
    cashuMeltToMainMintButtonLabel,
    cashuOperations,
    cashuProofs,
    cashuTokensHydratedRef,
    cashuTransferLifecycle,
    cashuTransfers,
    closeCashuPaymentRequestConfirmation,
    closeLightningInvoiceConfirmation,
    closeLnurlWithdrawConfirmation,
    closePaymentMintMeltConfirmation,
    confirmCashuPaymentRequest,
    confirmLightningInvoicePayment,
    confirmLnurlWithdraw,
    confirmPaymentMintMelt,
    contactPayMethod,
    defaultMintDisplay,
    defaultMintUrl,
    discardCashuDeferredReceive,
    estimateMintMove,
    getCashuTokenMessageInfo,
    getMintIconUrl,
    getMintRuntime,
    isCashuTokenKnownAny,
    isCashuTokenStored,
    knownLnAddressPayContact,
    knownLnAddressPayContactPictureUrl,
    lightningInvoiceAutoPayLimit,
    lnAddressPayAmount,
    lnAddressPayNote,
    lnurlWithdrawIsBusy,
    makeNip98AuthHeader,
    markCashuTokenExternalized,
    markCashuTokenIssued,
    markMintIconFailed,
    meltLargestForeignMintToMainMint,
    mintInfoByUrl,
    moveMintFunds,
    onPayChatPaymentRequest,
    paidOverlayDetails,
    paidOverlayIsOpen,
    paidOverlayPhase,
    paidOverlayTitle,
    payCashuPaymentRequest,
    payLightningAddressWithCashu,
    payLightningInvoiceWithCashu,
    paySelectedContact,
    payWithCashuEnabled,
    pendingCashuContactSend,
    pendingCashuPaymentRequestConfirmation,
    pendingCashuTokenContactPickId,
    pendingLightningInvoiceConfirmation,
    pendingLnurlWithdrawConfirmation,
    pendingPaymentMintMeltConfirmation,
    postPaySaveContact,
    probeLightningFee,
    receiveMethod,
    refreshMintInfo,
    requestSelectedContact,
    restoreMissingTokens,
    reclaimHandedOutTokens,
    restoreAndReclaimAllTokens,
    saveCashuFromText,
    sendCashuTokenToContact,
    setAllowTestMints,
    setContactPayMethod,
    setLightningInvoiceAutoPayLimit,
    setLnAddressPayAmount,
    setLnAddressPayNote,
    setMintInfoAll,
    setPayWithCashuEnabled,
    setReceiveMethod,
    setPendingLightningInvoiceConfirmation,
    setPendingLnurlWithdrawConfirmation,
    setPostPaySaveContact,
    settleBankPaymentOffer,
    recurringPaymentsContext,
  } = useCashuWalletComposition({
    contactPayBackToChatRef,
    copyText,
    contactsMessaging: {
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
    },
    fiatRates,
    formatDisplayedAmountParts,
    identity: {
      appOwnerId,
      currentNpub,
      currentNsec,
    },
    maybeShowPwaNotification,
    payAmount,
    profile: {
      npubCashInfoInFlightRef,
      npubCashInfoLoadedAtMsRef,
      npubCashInfoLoadedForNpubRef,
      setIsProfileEditing,
      setOwnedProfileLightningAddresses,
      setOwnedProfileLightningAddressesLoading,
    },
    pushToast,
    route,
    setContactPaymentIntent,
    setPayAmount,
    setStatus,
    t,
    transactions,
  });

  useAppPreferences({
    allowedDisplayCurrencies,
    bankPaymentOfferRecipientCount,
    bankPaymentOfferStaggerDelaySec,
    lightningInvoiceAutoPayLimit,
    payWithCashuEnabled,
    seenReceiptsEnabledAtSec,
    showProfileQrOnTiltEnabled,
  });

  const {
    closeLnurlAuthConfirmation,
    confirmLnurlAuth,
    lnurlAuthIsBusy,
    lnurlAuthIsDone,
    pendingLnurlAuthConfirmation,
    requestLnurlAuthConfirmation,
  } = useLnurlAuth({ currentNsec, setStatus, t });

  const {
    closeSiteLoginConfirmation,
    confirmSiteLogin,
    siteLoginIsBusy,
    siteLoginIsDone,
    pendingSiteLoginConfirmation,
    requestLinkauthLogin,
    requestSiteLoginConfirmation,
  } = useSiteLogin({ setStatus, t });

  const { navigateToMainReturn, openMenu } = useMainMenuState({ route });

  const {
    cancelPendingNfcWrite,
    canWriteNfc,
    closeScan,
    closeShareOptions,
    contactsGuide,
    contactsGuideActiveStep,
    contactsGuideHighlightRect,
    contactsOnboardingCelebrating,
    contactsOnboardingTasks,
    copyShareOptionsText,
    cycleScanCamera,
    dismissContactsOnboarding,
    nfcWritePromptKind,
    onPickScanImage,
    onSubmitManualPayText,
    openIssueTokenFromScan,
    openManualContactFromScan,
    openManualPayFromScan,
    openReceiveScan,
    openScan,
    openWalletScan,
    pasteScanValue,
    scanAllowsManualContact,
    scanDiagnostics,
    scanCanSwitchCamera,
    scanEntryPoint,
    scanIsOpen,
    scanVideoRef,
    shareCashuTokenText,
    shareOptionsText,
    shareOptionsViaEmail,
    shareOptionsViaSms,
    shareOptionsViaWhatsApp,
    shareText,
    showContactsOnboarding,
    stableContactsGuideNav,
    startContactsGuide,
    stopContactsGuide,
    writeCashuTokenToNfc,
    writeCurrentNpubToNfc,
  } = useScanNativeComposition({
    addNewContactFromIdentifier,
    cashuBalance,
    cashuTransfers,
    contacts,
    contactsLatestRef,
    contactsOnboardingDismissedSynced,
    contactsOnboardingHasBackedUpKeys,
    contactsOnboardingHasPaid,
    contactsOnboardingHasSentMessage,
    contactsRepository,
    copyText,
    currentNpub,
    currentNsec,
    dispatchInboxEvent,
    lightningInvoiceAutoPayLimit,
    markCashuTokenExternalized,
    markCashuTokenIssued,
    nostrBootstrapReady,
    openNewContactPage,
    openScannedContactPendingNpubRef,
    payCashuPaymentRequest,
    payLightningInvoiceWithCashu,
    persistContactsOnboardingDismissed,
    pushToast,
    requestLnurlAuthConfirmation,
    requestLinkauthLogin,
    requestSiteLoginConfirmation,
    route,
    saveCashuFromText,
    setPendingLightningInvoiceConfirmation,
    setPendingLnurlWithdrawConfirmation,
    setStatus,
    t,
  });

  const handleSelectContact = React.useCallback(
    (contact: DisplayContact) => {
      if (pendingCashuTokenContactPickId) {
        void sendCashuTokenToContact(contact, pendingCashuTokenContactPickId);
        return;
      }

      openContactDetail(contact);
    },
    [
      openContactDetail,
      pendingCashuTokenContactPickId,
      sendCashuTokenToContact,
    ],
  );

  const formatContactName = React.useMemo(
    () => createContactNameFormatter(Array.from(displayContactById.values())),
    [displayContactById],
  );

  const renderContactCard = React.useCallback(
    (contact: DisplayContact) => {
      const npub = normalizeNpubIdentifier(contact.npub ?? "");
      const avatarUrl = npub ? nostrPictureByNpub[npub] : null;
      const statusText = npub ? (nostrStatusByNpub[npub] ?? null) : null;
      const contactId = (contact.id ?? "").trim();
      const last = contactId ? lastMessageByContactId.get(contactId) : null;
      const lastText = (last?.content ?? "").trim();
      const tokenInfo =
        lastText && !parsePrivateImageMessage(lastText)
          ? getCashuTokenMessageInfo(lastText)
          : null;
      const hasAttention = contactId ? unreadByContactId.has(contactId) : false;

      return (
        <ContactCard
          key={contact.id ?? ""}
          contact={contact}
          nameLabel={formatContactName(contact)}
          avatarUrl={avatarUrl}
          lastMessage={last ?? null}
          hasAttention={hasAttention}
          isActive={(contact.id ?? "") === getDesktopActiveContactId(route)}
          isUnknownContact={Boolean(contact.isUnknownContact)}
          statusText={statusText}
          tokenInfo={tokenInfo}
          getMintIconUrl={getMintIconUrl}
          getNpubMessageContactInfo={getNpubMessageContactInfo}
          onSelect={handleSelectContact}
          onMintIconError={markMintIconFailed}
        />
      );
    },
    [
      formatContactName,
      getCashuTokenMessageInfo,
      getMintIconUrl,
      getNpubMessageContactInfo,
      markMintIconFailed,
      handleSelectContact,
      lastMessageByContactId,
      nostrPictureByNpub,
      nostrStatusByNpub,
      route,
      unreadByContactId,
    ],
  );

  const renderMainTabContactCard = React.useCallback(
    (contact: ContactRowLike): React.ReactNode => {
      const id = (contact.id ?? "").trim();
      if (!id) return null;
      const matched = displayContactById.get(id) ?? null;
      if (!matched) return null;
      return renderContactCard(matched);
    },
    [displayContactById, renderContactCard],
  );

  const conversationsLabel = t("conversations");
  const otherContactsLabel = t("otherContacts");

  const { exportAppData, handleImportAppDataFilePicked, requestImportAppData } =
    useAppDataTransfer<(typeof contacts)[number]>({
      cashuOperations,
      cashuProofs: allCashuProofs,
      contacts,
      contactsRepository,
      importCashuLegacyRows: cashuTransferLifecycle?.importLegacyRows ?? null,
      importCashuOperation: cashuTransferLifecycle?.importOperation ?? null,
      importCashuProofs: cashuTransferLifecycle?.importProofs ?? null,
      importDataFileInputRef,
      pushToast,
      t,
    });

  const copyNostrKeys = async () => {
    const nsec = currentNsec.trim();
    if (!nsec) return;
    await navigator.clipboard?.writeText(nsec);
    pushToast(t("nostrKeysCopied"));
  };

  const copySeed = async () => {
    const value = (slip39Seed ?? "").trim();
    if (value) {
      await navigator.clipboard?.writeText(value);
      safeLocalStorageSet(
        CONTACTS_ONBOARDING_HAS_BACKUPED_KEYS_STORAGE_KEY,
        "1",
      );
      setContactsOnboardingHasBackedUpKeys(true);
      pushToast(t("seedCopied"));
      return;
    }

    pushToast(t("seedMissing"));
  };

  const saveSeedToPasswordManager =
    async (): Promise<PasswordManagerSaveResult> => {
      const password = (slip39Seed ?? "").trim();
      if (!password) return "failed";

      return triggerPasswordManagerSeedSave({
        displayName: effectiveProfileName ?? currentNpub ?? "",
        password,
      });
    };

  const contactPayBackToChatId = contactPayBackToChatRef.current;
  const topbar = React.useMemo(
    () =>
      buildTopbar({
        closeContactDetail,
        contactPayBackToChatId,
        navigateToMainReturn,
        route,
        t,
      }),
    [
      closeContactDetail,
      contactPayBackToChatId,
      navigateToMainReturn,
      route,
      t,
    ],
  );

  useTopDownTilt({
    enabled: showProfileQrOnTiltEnabled && !scanIsOpen,
    onChange: (topDown) => {
      setProfileShareOverlayIsOpen(topDown);
      if (topDown) {
        reportAppLog({
          tag: "profileShare.tiltOpened",
          summary: "Phone flipped top-down: showing the contact card",
          payload: { route: route.kind },
        });
      }
    },
  });

  /**
   * The topmost dismissible modal in `AuthenticatedLayout`, or null.
   *
   * These modals are plain state rendered as siblings of the route content, so
   * nothing unmounts them on navigation — without this the Android back press
   * would move the route out from under an open payment confirmation and leave
   * its pending promise unresolved. Order is the reverse of the render order,
   * because the last sibling rendered is the one on top.
   */
  const dismissTopModal = ((): (() => void) | null => {
    if (shareOptionsText) return closeShareOptions;
    if (profileShareOverlayIsOpen) return closeProfileShareOverlay;
    if (nfcWritePromptKind && shouldRenderNativeNfcWritePrompt()) {
      return cancelPendingNfcWrite;
    }
    // The paid overlay hides every confirmation below it and clears itself when
    // the payment ends, so there is nothing for back to dismiss while it is up.
    if (paidOverlayIsOpen || lnurlAuthIsDone || siteLoginIsDone) {
      return null;
    }
    if (pendingPaymentMintMeltConfirmation) {
      return closePaymentMintMeltConfirmation;
    }
    if (pendingSiteLoginConfirmation) {
      return closeSiteLoginConfirmation;
    }
    if (pendingLnurlAuthConfirmation) return closeLnurlAuthConfirmation;
    if (pendingLnurlWithdrawConfirmation) {
      return closeLnurlWithdrawConfirmation;
    }
    if (pendingLightningInvoiceConfirmation) {
      return closeLightningInvoiceConfirmation;
    }
    if (pendingCashuPaymentRequestConfirmation) {
      return closeCashuPaymentRequestConfirmation;
    }
    if (postPaySaveContact) return () => setPostPaySaveContact(null);
    if (pendingIdentitySwitch) {
      return () => void answerPendingIdentitySwitch(null);
    }
    return null;
  })();

  useNativeBackHandler({
    closeScan,
    dismissTopModal,
    navigateBack: resolveBackAction(route, {
      closeContactDetail,
      contactPayBackToChatId,
      navigateToMainReturn,
    }),
    scanIsOpen,
  });

  const chatEditContactId =
    route.kind === "chat" && !selectedChatContact?.isUnknownContact
      ? parseContactId(selectedContact?.id)
      : null;
  const contactsFilterIsActive =
    contactsSearch.trim() !== "" || activeGroup !== null;
  const [showHiddenTransactions, setShowHiddenTransactions] = useAtom(
    hiddenTransactionsShownAtom,
  );
  const toggleHiddenTransactions = React.useCallback(() => {
    setShowHiddenTransactions((shown) => !shown);
  }, [setShowHiddenTransactions]);
  const topbarRight = React.useMemo(
    () =>
      buildTopbarRight({
        chatEditContactId,
        contactsFilterIsActive,
        hiddenTransactionsShown: showHiddenTransactions,
        isProfileEditing,
        openReceiveScan,
        openScan,
        route,
        t,
        toggleContactsFilter,
        toggleHiddenTransactions,
        openMenu,
      }),
    [
      chatEditContactId,
      contactsFilterIsActive,
      isProfileEditing,
      openReceiveScan,
      openScan,
      route,
      showHiddenTransactions,
      t,
      toggleContactsFilter,
      toggleHiddenTransactions,
      openMenu,
    ],
  );

  const topbarTitle = React.useMemo(
    () => buildTopbarTitle(route, t),
    [route, t],
  );

  const chatTopbarContact = React.useMemo(
    () =>
      route.kind === "chat" && selectedChatContact
        ? {
            contactId: selectedChatContact.isUnknownContact
              ? null
              : parseContactId(selectedContact?.id),
            isUnknownContact: Boolean(selectedChatContact.isUnknownContact),
            name: (selectedChatContact.name ?? "").trim() || null,
            npub: normalizeNpubIdentifier(selectedChatContact.npub ?? ""),
          }
        : null,
    [route.kind, selectedChatContact, selectedContact?.id],
  );

  useChatMessageEffects({
    autoAcceptedChatMessageIdsRef,
    cashuIsBusy,
    cashuTokensHydratedRef,
    chatDidInitialScrollForContactRef,
    chatForceScrollToBottomRef,
    chatLastMessageCountRef,
    chatMessageElByIdRef,
    chatMessages: chatMessagesWithBankPaymentOffers,
    chatMessagesRef,
    chatScrollTargetIdRef,
    getCashuTokenMessageInfo,
    isCashuTokenKnownAny,
    isCashuTokenStored,
    nostrBootstrapReady,
    nostrMessagesRecent,
    route,
    saveCashuFromText,
    selectedContact: selectedChatContact,
  });

  const moneyRouteProps = useMemoizedRouteBuilder(
    {
      bankPaymentOfferContacts,
      bankPaymentOfferRecipientCount,
      bankPaymentOfferStaggerDelaySec,
      canRestoreTokens: (seedMnemonic ?? "").trim().length > 0,
      canSendCashuTokenToContact: contacts.length > 0,
      canWriteNfc,
      contacts,
      effectiveMyLightningAddress,
      knownLnAddressPayContact,
      knownLnAddressPayContactPictureUrl,
      lnAddressPayAmount,
      lnAddressPayNote,
      nostrPictureByNpub,
      onRequestBankPaymentOffer: requestBankPaymentOffer,
      onSubmitManualPayText,
      openWalletScan,
      pasteScanValue,
      payLightningAddressWithCashu,
      profileStatusIsSaving,
      proxyPaymentPayerContacts,
      reclaimHandedOutTokens,
      restoreAndReclaimAllTokens,
      restoreMissingTokens,
      saveCashuFromText,
      selectedProfileStatusCurrencies,
      setLnAddressPayAmount,
      setLnAddressPayNote,
      shareCashuTokenText,
      t,
      tokenMessages: nostrMessagesLocal,
      toggleProfileStatusCurrency,
      writeCashuTokenToNfc,
    },
    buildMoneyRouteProps,
  );

  const restoreEditingContact = React.useCallback(() => {
    if (!editingId) return;
    restoreArchivedContact(editingId);
  }, [editingId, restoreArchivedContact]);

  const restoreCurrentContact = React.useCallback(() => {
    if (route.kind !== "contact") return;
    restoreArchivedContact(route.id);
  }, [restoreArchivedContact, route]);

  const peopleSelectedContact = React.useMemo(() => {
    const routeContactId =
      route.kind === "contact" ||
      route.kind === "contactEdit" ||
      route.kind === "contactPay"
        ? route.id
        : null;
    if (!selectedContact || !routeContactId) return null;

    return {
      archivedAtSec:
        typeof selectedContact.archivedAtSec === "number" ||
        typeof selectedContact.archivedAtSec === "string"
          ? selectedContact.archivedAtSec
          : null,
      groupName:
        typeof selectedContact.groupName === "string"
          ? selectedContact.groupName
          : null,
      groupNamesJson:
        typeof selectedContact.groupNamesJson === "string"
          ? selectedContact.groupNamesJson
          : null,
      id: routeContactId,
      lnAddress:
        typeof selectedContact.lnAddress === "string"
          ? selectedContact.lnAddress
          : null,
      name:
        typeof selectedContact.name === "string" ? selectedContact.name : null,
      npub:
        typeof selectedContact.npub === "string" ? selectedContact.npub : null,
    };
  }, [route, selectedContact]);

  const chatContactsGroupAssignment =
    React.useMemo<MessageContactsGroupAssignment | null>(
      () =>
        pendingContactsGroupAssignment
          ? {
              messageId: pendingContactsGroupAssignment.messageId,
              contactCount:
                pendingContactsGroupAssignment.savedContactIds.length,
              groupNames,
              onAssign: assignPendingContactsToGroup,
              onDismiss: closeContactsGroupAssignment,
            }
          : null,
      [
        assignPendingContactsToGroup,
        closeContactsGroupAssignment,
        groupNames,
        pendingContactsGroupAssignment,
      ],
    );

  const peopleRouteProps = useMemoizedRouteBuilder(
    {
      cashuBalance,
      cashuBalanceAfterMelt,
      cashuIsBusy,
      chatSelectedContact: selectedChatContact,
      addChatAttachments,
      chatAttachments,
      chatDraft,
      chatMessageElByIdRef,
      chatMessages: chatMessagesWithBankPaymentOffers,
      bankPaymentOfferMessages,
      chatMessagesRef,
      chatOwnPubkeyHex,
      chatSendIsBusy,
      canWriteNfc,
      contactEditsSavable,
      contactPaymentIntent,
      contactPayMethod,
      addNewContactFromSearchResult,
      contactSuggestions,
      contacts,
      copyText,
      currentNpub,
      derivedProfile,
      displayUnit,
      editingId,
      editContext,
      effectiveMyLightningAddress,
      effectiveProfileName,
      effectiveProfilePicture,
      feedbackContactNpub: FEEDBACK_CONTACT_NPUB,
      form,
      getCashuTokenMessageInfo,
      getMintIconUrl,
      getNpubMessageContactInfo,
      groupNames,
      handleSaveContact,
      isProfileEditing,
      isSavingContact,
      lang,
      mentionContacts,
      makeNip98AuthHeader,
      nostrPictureByNpub,
      onCancelEdit,
      onCancelReply,
      onAddUnknownContact: addUnknownContactFromChat,
      onAddNpubContacts: addNpubMessageContacts,
      contactsGroupAssignment: chatContactsGroupAssignment,
      onBlockUnknownContact: blockUnknownContactFromChat,
      onCopy: onCopyChatMessage,
      onDeclinePaymentRequest: onDeclineChatPaymentRequest,
      onEdit: onEditChatMessage,
      onOpenNpubContact: openNpubMessageContact,
      onPayPaymentRequest: onPayChatPaymentRequest,
      onRespondBankPaymentOffer: respondToBankPaymentOfferWithGroupState,
      onSettleBankPaymentOffer: settleBankPaymentOffer,
      shuffleProfileAvatar,
      onPickProfilePhoto,
      onProfilePhotoError,
      onProfilePhotoSelected,
      onReact: onReactToChatMessage,
      onReply: onReplyToChatMessage,
      openContactPay,
      searchNewContact,
      payAmount,
      payLightningInvoiceWithCashu,
      paySelectedContact,
      requestSelectedContact,
      payWithCashuEnabled,
      ownedLightningAddresses: ownedProfileLightningAddresses,
      route,
      selectedContactStatusText: (() => {
        const npub = normalizeNpubIdentifier(peopleSelectedContact?.npub ?? "");
        return npub ? (nostrStatusByNpub[npub] ?? null) : null;
      })(),
      reactionsByMessageId,
      profileCustomPictureUrl,
      profileEditLnAddress,
      profileEditName,
      profileEditPicture,
      profileEditStatus,
      profileEditsSavable,
      profileIsSaving,
      unregisteredOwnLightningAddress,
      profileStatus: myProfileStatus,
      profilePhotoInputRef,
      profileSelectedPictureKind,
      blockArchivedContact,
      restoreArchivedContact: restoreEditingContact,
      restoreSelectedContact: restoreCurrentContact,
      archiveCurrentContact,
      resetEditedContactFieldFromNostr,
      replyContext,
      saveClaimedLightningAddress,
      saveProfileEdits,
      selectedContact: peopleSelectedContact,
      selectedContactPublicProfile,
      sendChatImage,
      sendChatMessage: sendChatOrEditMessage,
      removeChatAttachment,
      setChatDraft,
      setContactPayMethod,
      setForm,
      markMintIconFailed,
      setPayAmount,
      setProfileEditLnAddress,
      setProfileEditName,
      setProfileEditStatus,
      shareText,
      t,
      writeCurrentNpubToNfc,
    },
    buildPeopleRouteProps,
  );

  const { mainTabRouteProps } = useRoutingViewComposition({
    groupNamesCount: groupNames.length,
    mainTabRouteBuilderInput: {
      activeBankPaymentOfferContacts,
      activeGroup,
      contactsOnboardingCelebrating,
      contactsOnboardingTasks,
      contactsFilterOpen,
      contactsSearch,
      contactsSearchInputRef,
      contactFilterOptions,
      conversationsLabel,
      dismissContactsOnboarding,
      openFeedbackContact,
      openNewContactPage,
      openWalletScan,
      otherContactsLabel,
      renderContactCard: renderMainTabContactCard,
      route,
      scanIsOpen,
      setActiveGroup,
      setContactsSearch,
      showContactsOnboarding,
      startContactsGuide,
      t,
      visibleContacts,
    },
    statusFilterCount: statusFilterCurrencies.length,
    ungroupedCount,
  });

  const {
    advancedSettingsContext,
    evoluSettingsContext,
    mintSettingsContext,
    relaySettingsContext,
  } = useSystemSettingsComposition({
    advancedSettingsInput: {
      answerPendingIdentitySwitch,
      canSwitchToDefaultIdentity,
      copyNostrKeys,
      copySeed,
      dedupeContacts,
      dedupeContactsIsBusy,
      defaultMintDisplay,
      evoluConnectedServerCount,
      evoluOverallStatus,
      evoluServerUrls,
      exportAppData,
      handleImportAppDataFilePicked,
      importDataFileInputRef,
      lightningInvoiceAutoPayLimit,
      logoutArmed,
      openScan,
      payWithCashuEnabled,
      pendingIdentitySwitch,
      pushToast,
      receiveMethod,
      relayUrls,
      requestImportAppData,
      requestLogout,
      requestPasteNostrKeys,
      saveSeedToPasswordManager,
      seedMnemonic,
      setLightningInvoiceAutoPayLimit,
      setPayWithCashuEnabled,
      setReceiveMethod,
      switchToDefaultIdentity,
    },
    evoluSettingsInput: {
      evoluDatabaseBytes: evoluDbInfo.info.bytes,
      evoluHasError,
      evoluErrorType: evoluLastError?.type ?? null,
      evoluHistoryCount: evoluDbInfo.info.historyCount,
      evoluServerStatusByUrl,
      evoluServerUrls,
      evoluServersReloadRequired,
      evoluShards,
      evoluSyncOwnerIds,
      evoluTableCounts: evoluDbInfo.info.tableCounts,
      evoluWipeStorageIsBusy,
      isEvoluServerOffline,
      isEvoluServerRecommended,
      newEvoluServerUrl,
      requestRotateShard: shardRotation.rotate,
      rotatingShardScope: shardRotation.busyScope,
      saveEvoluServerUrls,
      setEvoluServerOffline,
      setNewEvoluServerUrl,
      setStatus,
      syncOwnerId: appOwnerId,
      wipeEvoluStorage,
    },
    mintSettingsInput: {
      allowTestMints,
      appOwnerIdRef,
      applyDefaultMintSelection,
      cashuIsBusy,
      cashuDeferredReceives,
      cashuMeltToMainMintButtonLabel,
      cashuProofs,
      defaultMintUrl,
      discardCashuDeferredReceive,
      estimateMintMove,
      getMintIconUrl,
      getMintRuntime,
      meltLargestForeignMintToMainMint,
      mintInfoByUrl,
      moveMintFunds,
      probeLightningFee,
      refreshMintInfo,
      setAllowTestMints,
      setMintInfoAll,
      setStatus,
    },
    relaySettingsInput: {
      canSaveNewRelay,
      isRecommendedRelay,
      newRelayUrl,
      pendingRelayDeleteUrl,
      relayUrls,
      requestDeleteSelectedRelay,
      saveNewRelay,
      selectedRelayUrl,
      setNewRelayUrl,
    },
    t,
  });

  const appState = React.useMemo(
    () => ({
      allowedDisplayCurrencies,
      cashuBalance,
      cashuBalanceAfterMelt,
      cashuIsBusy,
      canWriteNfc,
      chatTopbarContact,
      contactsGuide,
      contactsGuideActiveStep,
      contactsGuideHighlightRect,
      currentNpub,
      currentNsec,
      decimalAmountInputEnabled,
      sendReadReceiptsEnabled: seenReceiptsEnabledAtSec !== null,
      displayCurrency,
      derivedProfile,
      displayUnit,
      effectiveMyLightningAddress,
      effectiveProfileName,
      effectiveProfilePicture,
      evoluAppOwnerId: appOwnerId ? appOwnerId : null,
      fiatRates,
      formatDisplayedAmountParts,
      formatDisplayedAmountText,
      isProfileEditing,
      lang,
      nfcWritePromptKind,
      nostrPictureByNpub,
      paidOverlayDetails,
      paidOverlayIsOpen,
      paidOverlayPhase,
      paidOverlayTitle,
      pendingPaymentMintMeltConfirmation,
      pendingLnurlAuthConfirmation,
      pendingLnurlWithdrawConfirmation,
      pendingSiteLoginConfirmation,
      pendingLightningInvoiceConfirmation,
      pendingCashuPaymentRequestConfirmation,
      postPaySaveContact,
      profileCustomPictureUrl,
      profileEditInitialRef,
      profileEditLnAddress,
      profileEditName,
      profileEditPicture,
      profileEditStatus,
      profileEditsSavable,
      profileIsSaving,
      profileStatus: myProfileStatus,
      profileStatusCurrencies,
      profilePhotoInputRef,
      profileSelectedPictureKind,
      profileShareOverlayIsOpen,
      route,
      scanAllowsManualContact,
      scanDiagnostics,
      scanCanSwitchCamera,
      scanEntryPoint,
      scanIsOpen,
      shareOptionsText,
      showProfileQrOnTiltEnabled,
      scanVideoRef,
      t,
      topbar,
      topbarRight,
      topbarTitle,
      lnurlAuthIsBusy,
      lnurlAuthIsDone,
      lnurlWithdrawIsBusy,
      siteLoginIsBusy,
      siteLoginIsDone,
    }),
    [
      allowedDisplayCurrencies,
      appOwnerId,
      cashuBalance,
      cashuBalanceAfterMelt,
      cashuIsBusy,
      canWriteNfc,
      chatTopbarContact,
      contactsGuide,
      contactsGuideActiveStep,
      contactsGuideHighlightRect,
      currentNpub,
      currentNsec,
      decimalAmountInputEnabled,
      seenReceiptsEnabledAtSec,
      derivedProfile,
      displayCurrency,
      displayUnit,
      effectiveMyLightningAddress,
      effectiveProfileName,
      effectiveProfilePicture,
      fiatRates,
      formatDisplayedAmountParts,
      formatDisplayedAmountText,
      isProfileEditing,
      lang,
      lnurlAuthIsBusy,
      lnurlAuthIsDone,
      lnurlWithdrawIsBusy,
      myProfileStatus,
      siteLoginIsBusy,
      siteLoginIsDone,
      nfcWritePromptKind,
      nostrPictureByNpub,
      paidOverlayDetails,
      paidOverlayIsOpen,
      paidOverlayPhase,
      paidOverlayTitle,
      pendingLightningInvoiceConfirmation,
      pendingCashuPaymentRequestConfirmation,
      pendingLnurlAuthConfirmation,
      pendingLnurlWithdrawConfirmation,
      pendingSiteLoginConfirmation,
      pendingPaymentMintMeltConfirmation,
      postPaySaveContact,
      profileCustomPictureUrl,
      profileEditInitialRef,
      profileEditLnAddress,
      profileEditName,
      profileEditPicture,
      profileEditStatus,
      profileEditsSavable,
      profileIsSaving,
      profilePhotoInputRef,
      profileSelectedPictureKind,
      profileStatusCurrencies,
      route,
      scanAllowsManualContact,
      scanDiagnostics,
      scanCanSwitchCamera,
      scanEntryPoint,
      scanIsOpen,
      scanVideoRef,
      shareOptionsText,
      showProfileQrOnTiltEnabled,
      profileShareOverlayIsOpen,
      t,
      topbar,
      topbarRight,
      topbarTitle,
    ],
  );

  const appActions = React.useMemo(
    () => ({
      cancelPendingNfcWrite,
      closePaymentMintMeltConfirmation,
      closeProfileShareOverlay,
      closeLnurlAuthConfirmation,
      closeLnurlWithdrawConfirmation,
      closeSiteLoginConfirmation,
      closeShareOptions,
      closeLightningInvoiceConfirmation,
      closeScan,
      closeCashuPaymentRequestConfirmation,
      confirmPaymentMintMelt,
      confirmLnurlAuth,
      confirmLnurlWithdraw,
      confirmSiteLogin,
      confirmLightningInvoicePayment,
      confirmCashuPaymentRequest,
      contactsGuideNav: stableContactsGuideNav,
      copyShareOptionsText,
      copyText,
      cycleScanCamera,
      shuffleProfileAvatar,
      onPickProfilePhoto,
      onPickScanImage,
      onProfilePhotoError,
      onProfilePhotoSelected,
      openFeedbackContact,
      openIssueTokenFromScan,
      openManualContactFromScan,
      openManualPayFromScan,
      openProfileQr,
      openReceiveScan,
      pasteScanValue,
      saveProfileEdits,
      setContactNewPrefill,
      setIsProfileEditing,
      setLang,
      setLightningInvoiceAutoPayLimit,
      setPostPaySaveContact,
      setProfileEditLnAddress,
      setProfileEditName,
      setProfileEditStatus,
      setDisplayCurrency: setDisplayCurrencyIfAllowed,
      stopContactsGuide,
      shareOptionsViaEmail,
      shareOptionsViaSms,
      shareOptionsViaWhatsApp,
      toggleAllowedDisplayCurrency,
      toggleDecimalAmountInput,
      toggleProfileEditing,
      toggleSendReadReceipts,
      toggleShowProfileQrOnTilt,
      writeCurrentNpubToNfc,
    }),
    [
      cancelPendingNfcWrite,
      closeLightningInvoiceConfirmation,
      closeLnurlAuthConfirmation,
      closeLnurlWithdrawConfirmation,
      closeSiteLoginConfirmation,
      closePaymentMintMeltConfirmation,
      closeProfileShareOverlay,
      closeScan,
      closeShareOptions,
      closeCashuPaymentRequestConfirmation,
      confirmLightningInvoicePayment,
      confirmCashuPaymentRequest,
      confirmLnurlAuth,
      confirmLnurlWithdraw,
      confirmSiteLogin,
      confirmPaymentMintMelt,
      stableContactsGuideNav,
      copyShareOptionsText,
      copyText,
      cycleScanCamera,
      shuffleProfileAvatar,
      onPickProfilePhoto,
      onPickScanImage,
      onProfilePhotoError,
      onProfilePhotoSelected,
      openFeedbackContact,
      openIssueTokenFromScan,
      openManualContactFromScan,
      openManualPayFromScan,
      openProfileQr,
      openReceiveScan,
      pasteScanValue,
      saveProfileEdits,
      setContactNewPrefill,
      setDisplayCurrencyIfAllowed,
      setIsProfileEditing,
      setLang,
      setLightningInvoiceAutoPayLimit,
      setPostPaySaveContact,
      setProfileEditLnAddress,
      setProfileEditName,
      setProfileEditStatus,
      shareOptionsViaEmail,
      shareOptionsViaSms,
      shareOptionsViaWhatsApp,
      stopContactsGuide,
      toggleAllowedDisplayCurrency,
      toggleDecimalAmountInput,
      toggleProfileEditing,
      toggleSendReadReceipts,
      toggleShowProfileQrOnTilt,
      writeCurrentNpubToNfc,
    ],
  );

  return {
    appActions,
    appState,
    cancelPendingCashuContactSend,
    dismissToast,
    displayUnit,
    formatDisplayedAmountParts,
    formatDisplayedAmountText,
    lang,
    mainTabRouteProps,
    moneyRouteProps,
    peopleRouteProps,
    pendingCashuContactSend,
    pushToast,
    route,
    setLang,
    advancedSettingsContext,
    evoluSettingsContext,
    mintSettingsContext,
    recurringPaymentsContext,
    relaySettingsContext,
    t,
    toasts,
  };
};
