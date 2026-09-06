import { useMemoizedRouteBuilder } from "./hooks/composition/useMemoizedRouteBundle";
import * as Evolu from "@evolu/common";
import { useQuery } from "@evolu/react";
import React, { useMemo, useState } from "react";
import type { MessageContactsGroupAssignment } from "../components/ChatMessage";
import { ContactCard } from "../components/ContactCard";
import {
  createCashuTokensAllQuery,
  evolu,
  useEvolu,
  useEvoluDatabaseInfoState,
  useEvoluLastError,
  useEvoluServersManager,
  wipeEvoluStorage as wipeEvoluStorageImpl,
  type ContactId,
} from "../evolu";
import { useRouting } from "../hooks/useRouting";
import { useToasts } from "../hooks/useToasts";
import { writeClipboardText } from "../platform/clipboard";
import { shouldRenderNativeNfcWritePrompt } from "../platform/nativeBridge";
import {
  triggerPasswordManagerSeedSave,
  type PasswordManagerSaveResult,
} from "../platform/passwordManager";
import {
  CONTACTS_ONBOARDING_HAS_BACKUPED_KEYS_STORAGE_KEY,
  FEEDBACK_CONTACT_NPUB,
} from "../utils/constants";
import {
  applyAmountInputKey,
  applyAmountInputKeyWithDraft,
  formatDisplayAmountParts,
  formatDisplayAmountText,
  getDisplayUnitLabel,
  getNextDisplayCurrency,
  isFiatDisplayCurrency,
  normalizeAllowedDisplayCurrencies,
  type DisplayCurrency,
} from "../utils/displayAmounts";
import { MAIN_MINT_URL, normalizeMintUrl } from "../utils/mint";
import { normalizeNpubIdentifier } from "../utils/nostrNpub";
import {
  getInitialAllowedDisplayCurrencies,
  getInitialDecimalAmountInputEnabled,
  getInitialDisplayCurrency,
  getInitialSeenReceiptsEnabledAtSec,
  safeLocalStorageGet,
  safeLocalStorageSet,
} from "../utils/storage";
import {
  logPayStep,
  useCashuWalletComposition,
} from "./hooks/composition/useCashuWalletComposition";
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
import { useMainSwipeNavigation } from "./hooks/layout/useMainSwipeNavigation";
import { useNativeBackHandler } from "./hooks/layout/useNativeBackHandler";
import { isUnknownContactId } from "./hooks/messages/contactIdentity";
import { useChatMessageEffects } from "./hooks/messages/useChatMessageEffects";
import { useAppDataTransfer } from "./hooks/useAppDataTransfer";
import { useAppLanguage } from "./hooks/useAppLanguage";
import { useAppPreferences } from "./hooks/useAppPreferences";
import { useArmedDeleteTimeouts } from "./hooks/useArmedDeleteTimeouts";
import { useFiatRates } from "./hooks/useFiatRates";
import { useOwnerScopedStorage } from "./hooks/useOwnerScopedStorage";
import { useStatusToasts } from "./hooks/useStatusToasts";
import { useStoragePersistRequestEffect } from "./hooks/useStoragePersistRequestEffect";
import {
  buildIdentityChangeMessageContent,
  buildIdentityChangeMessageWrapId,
} from "./lib/identityChangeMessage";
import {
  buildDismissedOnboardingTutorialOwnerMetaPayload,
  hasDismissedOnboardingTutorialOwnerMetaRow,
  ONBOARDING_TUTORIAL_OWNER_META_SCOPE,
} from "./lib/onboardingTutorialSync";
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

const AppContactId = Evolu.id("Contact");

const parseContactId = (value: unknown): ContactId | null => {
  const result = AppContactId.fromUnknown(value);
  return result.ok ? result.value : null;
};

interface UseAppShellCompositionParams {
  currentNsec: string;
  setCurrentNsec: (currentNsec: string | null) => void;
}

export const useAppShellComposition = ({
  currentNsec,
  setCurrentNsec,
}: UseAppShellCompositionParams) => {
  const { insert, update, upsert } = useEvolu();

  const route = useRouting();
  const { dismissToast, toasts, pushToast } = useToasts();
  const { lang, setLang, t } = useAppLanguage();
  const {
    activeSyncedNostrIdentity,
    appOwnerId,
    appOwnerIdRef,
    appendIdentityChangeNoticesRef,
    cashuOwnerEditsUntilRotation,
    cashuOwnerId,
    cashuOwnerIdRef,
    cashuOwnerIndex,
    cashuVisibleOwnerIds,
    contactsOwnerEditCount,
    contactsOwnerEditsUntilRotation,
    contactsOwnerId,
    contactsOwnerIndex,
    contactsOwnerNewContactsCount,
    contactsOwnerPointer,
    contactsVisibleOwnerIds,
    currentNpub,
    historicalOwnerSetsReady,
    identityOwnerId,
    isSeedLogin,
    legacyIdentitiesOwnerId,
    legacyMessagesIdentityOwnerId,
    logoutArmed,
    messagesOwnerEditsUntilRotation,
    messagesOwnerId,
    messagesOwnerIdRef,
    messagesOwnerIndex,
    messagesVisibleOwnerIds,
    metaOwnerId,
    myProfileMetadataRef,
    nostrIdentityRows,
    requestLogout,
    requestManualRotateCashuOwner,
    requestManualRotateContactsOwner,
    requestManualRotateMessagesOwner,
    requestManualRotateTransactionsOwner,
    requestPasteNostrKeys,
    rotateCashuOwnerIsBusy,
    rotateContactsOwnerIsBusy,
    rotateMessagesOwnerIsBusy,
    rotateTransactionsOwnerIsBusy,
    seedMnemonic,
    slip39Seed,
    syncedNostrIdentityMatchesLocal,
    syncedNostrIdentityResolution,
    syncOwner,
    transactionsBootstrapSnapshot,
    transactionsOwnerEditsUntilRotation,
    transactionsOwnerId,
    transactionsOwnerIdRef,
    transactionsOwnerIndex,
    transactionsOwnerPointer,
    transactionsVisibleOwnerIds,
  } = useIdentityOwnersComposition({
    currentNsec,
    evolu,
    lang,
    navigation: globalThis.location,
    pushToast,
    setCurrentNsec,
    t,
    upsert,
  });

  const {
    logPaymentEvent,
    makeLocalStorageKey,
    migrateLegacyPaymentEventsToEvolu,
    readSeenMintsFromStorage,
    rememberSeenMint,
  } = useOwnerScopedStorage({
    appOwnerIdRef,
    insert,
    transactionsOwnerIdRef,
  });

  const evoluServers = useEvoluServersManager();
  const evoluServerUrls = evoluServers.configuredUrls;
  const evoluActiveServerUrls = evoluServers.activeUrls;
  const evoluServerStatusByUrl = evoluServers.statusByUrl;
  const evoluServersReloadRequired = evoluServers.reloadRequired;
  const saveEvoluServerUrls = evoluServers.setServerUrls;
  const isEvoluServerOffline = evoluServers.isOffline;
  const setEvoluServerOffline = evoluServers.setServerOffline;

  const [newEvoluServerUrl, setNewEvoluServerUrl] = useState("");

  const [status, setStatus] = useState<string | null>(null);
  const importDataFileInputRef = React.useRef<HTMLInputElement | null>(null);

  const [pendingEvoluServerDeleteUrl, setPendingEvoluServerDeleteUrl] =
    useState<string | null>(null);
  const mainSwipeRef = React.useRef<HTMLDivElement | null>(null);
  const mainSwipeScrollTimerRef = React.useRef<number | null>(null);
  const [allowedDisplayCurrencies, setAllowedDisplayCurrencies] = useState<
    DisplayCurrency[]
  >(() => getInitialAllowedDisplayCurrencies());
  const [displayCurrency, setDisplayCurrency] = useState<DisplayCurrency>(() =>
    getInitialDisplayCurrency(),
  );
  const [decimalAmountInputEnabled, setDecimalAmountInputEnabled] =
    useState<boolean>(getInitialDecimalAmountInputEnabled);
  const [seenReceiptsEnabledAtSec, setSeenReceiptsEnabledAtSec] = useState<
    number | null
  >(getInitialSeenReceiptsEnabledAtSec);

  React.useEffect(() => {
    if (allowedDisplayCurrencies.includes(displayCurrency)) return;
    setDisplayCurrency(allowedDisplayCurrencies[0] ?? "sat");
  }, [allowedDisplayCurrencies, displayCurrency]);

  const setDisplayCurrencyIfAllowed = React.useCallback(
    (currency: DisplayCurrency) => {
      if (!allowedDisplayCurrencies.includes(currency)) return;
      setDisplayCurrency(currency);
    },
    [allowedDisplayCurrencies],
  );

  const cycleDisplayCurrency = React.useCallback(() => {
    setDisplayCurrency((current) =>
      getNextDisplayCurrency(current, allowedDisplayCurrencies),
    );
  }, [allowedDisplayCurrencies]);

  const toggleAllowedDisplayCurrency = React.useCallback(
    (currency: DisplayCurrency) => {
      setAllowedDisplayCurrencies((current) => {
        if (current.includes(currency)) {
          if (current.length <= 1) return current;
          return current.filter((candidate) => candidate !== currency);
        }

        return normalizeAllowedDisplayCurrencies(
          current.concat(currency),
          currency,
        );
      });
    },
    [],
  );

  const toggleDecimalAmountInput = React.useCallback(() => {
    setDecimalAmountInputEnabled((current) => !current);
  }, []);

  // Enabling records the baseline: only messages newer than it are ever
  // reported as seen, so pre-enable history stays unreported.
  const toggleSendReadReceipts = React.useCallback(() => {
    setSeenReceiptsEnabledAtSec((current) =>
      current === null ? nowSeconds() : null,
    );
  }, []);

  const fiatRates = useFiatRates();
  const displayUnit = getDisplayUnitLabel(displayCurrency, lang);
  const decimalAmountInputKeyVisible =
    decimalAmountInputEnabled &&
    isFiatDisplayCurrency(displayCurrency) &&
    fiatRates !== null;
  const applyDisplayedAmountInputKey = React.useCallback(
    (currentAmount: string, key: string) =>
      applyAmountInputKey(currentAmount, key, {
        displayCurrency,
        fiatRates,
        lang,
      }),
    [displayCurrency, fiatRates, lang],
  );
  const applyDisplayedAmountInputKeyWithDraft = React.useCallback(
    (currentAmount: string, currentDisplayValue: string | null, key: string) =>
      applyAmountInputKeyWithDraft(
        currentAmount,
        currentDisplayValue,
        key,
        { displayCurrency, fiatRates, lang },
        decimalAmountInputKeyVisible,
      ),
    [decimalAmountInputKeyVisible, displayCurrency, fiatRates, lang],
  );
  const formatDisplayedAmountParts = React.useCallback(
    (amountSat: number) =>
      formatDisplayAmountParts(amountSat, {
        displayCurrency,
        fiatRates,
        lang,
      }),
    [displayCurrency, fiatRates, lang],
  );
  const formatDisplayedAmountText = React.useCallback(
    (amountSat: number) =>
      formatDisplayAmountText(amountSat, {
        displayCurrency,
        fiatRates,
        lang,
      }),
    [displayCurrency, fiatRates, lang],
  );

  const evoluLastError = useEvoluLastError({ logToConsole: true });
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
    // Last-resort recovery: wipe local Evolu storage and reload.
    try {
      wipeEvoluStorageImpl();
    } catch {
      // ignore
    }
  }, [evoluLastError]);

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
    if (!syncOwner) return "disconnected" as const;
    if (evoluHasError) return "disconnected" as const;
    if (evoluActiveServerUrls.length === 0) return "disconnected" as const;
    const states = evoluActiveServerUrls.map(
      (url) => evoluServerStatusByUrl[url] ?? "checking",
    );
    if (states.some((s) => s === "connected")) return "connected" as const;
    if (states.some((s) => s === "checking")) return "checking" as const;
    return "disconnected" as const;
  }, [evoluActiveServerUrls, evoluHasError, evoluServerStatusByUrl, syncOwner]);

  const [evoluWipeStorageIsBusy, setEvoluWipeStorageIsBusy] =
    useState<boolean>(false);

  const wipeEvoluStorage = React.useCallback(async () => {
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
  }, [evoluLastError, evoluWipeStorageIsBusy, pushToast, t]);

  const [contactPaymentIntent, setContactPaymentIntent] = useState<
    "pay" | "request"
  >("pay");
  const [payAmount, setPayAmount] = useState<string>("");
  const onboardingTutorialOwnerId = isSeedLogin ? metaOwnerId : appOwnerId;
  const onboardingTutorialOwnerMetaQuery = useMemo(
    () =>
      evolu.createQuery((db) =>
        db
          .selectFrom("ownerMeta")
          .selectAll()
          .where("isDeleted", "is not", Evolu.sqliteTrue)
          .where("scope", "=", ONBOARDING_TUTORIAL_OWNER_META_SCOPE),
      ),
    [],
  );
  const onboardingTutorialOwnerMetaRows = useQuery(
    onboardingTutorialOwnerMetaQuery,
  );
  const contactsOnboardingDismissedSynced = React.useMemo(
    () =>
      hasDismissedOnboardingTutorialOwnerMetaRow(
        onboardingTutorialOwnerMetaRows,
        onboardingTutorialOwnerId,
      ),
    [onboardingTutorialOwnerId, onboardingTutorialOwnerMetaRows],
  );
  const persistContactsOnboardingDismissed = React.useCallback(() => {
    if (!onboardingTutorialOwnerId) return;
    if (contactsOnboardingDismissedSynced) return;
    upsert("ownerMeta", buildDismissedOnboardingTutorialOwnerMetaPayload(), {
      ownerId: onboardingTutorialOwnerId,
    });
  }, [contactsOnboardingDismissedSynced, onboardingTutorialOwnerId, upsert]);

  const evoluHistoryAllowedOwnerIds = React.useMemo(() => {
    const ids = [
      (appOwnerId ?? "").trim(),
      ...cashuVisibleOwnerIds.map((ownerId) => ownerId.trim()),
      ...messagesVisibleOwnerIds.map((ownerId) => ownerId.trim()),
      ...transactionsVisibleOwnerIds.map((ownerId) => ownerId.trim()),
      (metaOwnerId ?? "").trim(),
      ...contactsVisibleOwnerIds.map((ownerId) => ownerId.trim()),
    ].filter(Boolean);
    return Array.from(new Set(ids));
  }, [
    appOwnerId,
    cashuVisibleOwnerIds,
    contactsVisibleOwnerIds,
    messagesVisibleOwnerIds,
    metaOwnerId,
    transactionsVisibleOwnerIds,
  ]);

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

  useStatusToasts({
    pushToast,
    setStatus,
    status,
  });

  const cashuTokensAllQuery = useMemo(createCashuTokensAllQuery, []);
  const cashuTokensAll = useQuery(cashuTokensAllQuery);

  const copyText = React.useCallback(
    async (value: string) => {
      try {
        const copied = await writeClipboardText(value);
        if (!copied) {
          pushToast(t("copyFailed"));
          return;
        }
        pushToast(t("copiedToClipboard"));
      } catch {
        pushToast(t("copyFailed"));
      }
    },
    [pushToast, t],
  );

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
    bankPaymentOfferContacts,
    bankPaymentOfferMessages,
    bankPaymentOfferRecipientCount,
    bankPaymentOfferStaggerDelaySec,
    blockArchivedContact,
    blockUnknownContactFromChat,
    canAddContact,
    canSaveNewRelay,
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
    isSavingContact,
    lastMessageByContactId,
    mentionContacts,
    newRelayUrl,
    nostrBootstrapReady,
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
    pendingDeleteId,
    pendingPayments,
    pendingRelayDeleteUrl,
    reactionsByMessageId,
    relayUrls,
    removePendingPayment,
    replyContext,
    requestBankPaymentOffer,
    requestDeleteCurrentContact,
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
    setActiveGroup,
    setChatDraft,
    setContactNewPrefill,
    setContactsOnboardingHasBackedUpKeys,
    setContactsOnboardingHasPaid,
    setContactsSearch,
    setForm,
    setNewRelayUrl,
    setPendingDeleteId,
    statusFilterCurrencies,
    ungroupedCount,
    unreadByContactId,
    updateLocalNostrMessage,
    visibleContacts,
  } = useContactsMessagingComposition({
    activeSyncedNostrIdentity,
    appOwnerId,
    appOwnerIdRef,
    cashuOwnerId,
    cashuTokensAll,
    contactPayBackToChatRef,
    contactsOwnerId,
    contactsOwnerNewContactsCount,
    contactsVisibleOwnerIds,
    copyText,
    currentNpub,
    currentNsec,
    formatDisplayedAmountText,
    historicalOwnerSetsReady,
    identityOwnerId,
    insert,
    isSeedLogin,
    lang,
    legacyIdentitiesOwnerId,
    legacyMessagesIdentityOwnerId,
    logPayStep,
    maybeShowPwaNotification,
    messagesOwnerId,
    messagesOwnerIdRef,
    messagesVisibleOwnerIds,
    metaOwnerId,
    nostrIdentityRows,
    pushToast,
    route,
    seenReceiptsEnabledAtSec,
    setContactPaymentIntent,
    setPayAmount,
    setStatus,
    syncedNostrIdentityMatchesLocal,
    syncedNostrIdentityResolution,
    t,
    transactionsBootstrapSnapshot,
    transactionsOwnerId,
    update,
    upsert,
  });

  React.useEffect(() => {
    appendIdentityChangeNoticesRef.current = ({
      changedAtSec,
      identitySource,
    }) => {
      if (!Number.isFinite(changedAtSec) || changedAtSec <= 0) return;

      for (const contactId of lastMessageByContactId.keys()) {
        const normalizedContactId = contactId.trim();
        if (!normalizedContactId) continue;
        if (isUnknownContactId(normalizedContactId)) continue;

        appendLocalNostrMessage({
          contactId: normalizedContactId,
          content: buildIdentityChangeMessageContent({
            changedAtSec,
            source: identitySource,
          }),
          createdAtSec: Math.trunc(changedAtSec),
          direction: "out",
          localOnly: true,
          pubkey: "",
          rumorId: null,
          wrapId: buildIdentityChangeMessageWrapId({
            changedAtSec,
            contactId: normalizedContactId,
            source: identitySource,
          }),
        });
      }
    };

    return () => {
      appendIdentityChangeNoticesRef.current = null;
    };
  }, [
    appendIdentityChangeNoticesRef,
    appendLocalNostrMessage,
    lastMessageByContactId,
  ]);

  const {
    cycleProfileAvatarControl,
    derivedProfile,
    effectiveMyLightningAddress,
    effectiveProfileName,
    effectiveProfilePicture,
    isProfileEditing,
    myProfileMetadata,
    myProfileQr,
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
    profilePhotoInputRef,
    profileSelectedPictureKind,
    profileStatusCurrencies,
    profileStatusIsSaving,
    saveClaimedLightningAddress,
    saveProfileEdits,
    selectedProfileStatusCurrencies,
    setIsProfileEditing,
    setMyProfileQr,
    setOwnedProfileLightningAddresses,
    setOwnedProfileLightningAddressesLoading,
    setProfileEditLnAddress,
    setProfileEditName,
    setProfileEditStatus,
    showProfileQrOnTiltEnabled,
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
    route,
    setStatus,
    t,
  });

  // The identity-owners composition runs before the profile composition, so
  // the key-switch flow reaches the current profile through this ref.
  React.useEffect(() => {
    myProfileMetadataRef.current = myProfileMetadata;
  }, [myProfileMetadata, myProfileMetadataRef]);

  const {
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
    cashuIssuedTokens,
    cashuMeltToMainMintButtonLabel,
    cashuOwnSpentTokens,
    cashuOwnTokens,
    cashuTokensAllFiltered,
    cashuTokensFiltered,
    cashuTokensHydratedRef,
    cashuTotalBalance,
    checkAllCashuTokensAndDeleteInvalid,
    checkAndRefreshCashuToken,
    checkIssuedCashuTokensAndDeleteClaimed,
    checkSingleIssuedCashuTokenIsClaimed,
    closeLightningInvoiceConfirmation,
    closeLnurlWithdrawConfirmation,
    closePaymentMintMeltConfirmation,
    confirmLightningInvoicePayment,
    confirmLnurlWithdraw,
    confirmPaymentMintMelt,
    contactPayMethod,
    defaultMintDisplay,
    defaultMintUrl,
    defaultMintUrlDraft,
    deleteSpentCashuTokens,
    deleteSpentCashuTokensIsBusy,
    dismissWalletWarning,
    emitCashuToken,
    getCashuTokenMessageInfo,
    getMintIconUrl,
    getMintRuntime,
    handleMintIconError,
    handleMintIconLoad,
    isCashuTokenKnownAny,
    isCashuTokenStored,
    knownLnAddressPayContact,
    knownLnAddressPayContactPictureUrl,
    lightningInvoiceAutoPayLimit,
    lnAddressPayAmount,
    lnurlWithdrawIsBusy,
    makeNip98AuthHeader,
    markCashuTokenExternalized,
    markCashuTokenIssued,
    meltLargestForeignMintToMainMint,
    mintInfoByUrl,
    onPayChatPaymentRequest,
    paidOverlayIsOpen,
    paidOverlayTitle,
    payCashuPaymentRequest,
    payLightningAddressWithCashu,
    payLightningInvoiceWithCashu,
    paySelectedContact,
    payWithCashuEnabled,
    pendingCashuContactSend,
    pendingCashuDeleteId,
    pendingCashuTokenContactPickId,
    pendingLightningInvoiceConfirmation,
    pendingLnurlWithdrawConfirmation,
    pendingMintDeleteUrl,
    pendingPaymentMintMeltConfirmation,
    postPaySaveContact,
    probeLightningFee,
    refreshMintInfo,
    requestDeleteCashuToken,
    requestSelectedContact,
    reserveCashuToken,
    restoreMissingTokens,
    returnCashuTokenToWallet,
    saveCashuFromText,
    sendCashuTokenToContact,
    setCashuDraft,
    setCashuEmitAmount,
    setContactPayMethod,
    setDefaultMintUrlDraft,
    setLightningInvoiceAutoPayLimit,
    setLnAddressPayAmount,
    setMintIconUrlByMint,
    setMintInfoAll,
    setPayWithCashuEnabled,
    setPendingCashuDeleteId,
    setPendingLightningInvoiceConfirmation,
    setPendingLnurlWithdrawConfirmation,
    setPendingMintDeleteUrl,
    setPostPaySaveContact,
    setTopupAmount,
    settleBankPaymentOffer,
    showPaidOverlay,
    startSendCashuTokenToContact,
    tokensRestoreIsBusy,
    topupAmount,
    topupInvoice,
    topupInvoiceCashuRequest,
    topupInvoiceError,
    topupInvoiceIsBusy,
    topupInvoiceQr,
    topupInvoiceQrPayload,
    topupMintUrl,
    walletWarningApplies,
    walletWarningDismissed,
  } = useCashuWalletComposition({
    cashuTokensAll,
    contactPayBackToChatRef,
    contactsMessaging: {
      saveNpubContact,
      appendLocalNostrMessage,
      chatMessages,
      contacts,
      enqueuePendingPayment,
      isBankPaymentOfferCanceled,
      nostrBootstrapReady,
      nostrMessagesLocal,
      nostrMessagesRecent,
      nostrPictureByNpub,
      openScannedContactPendingNpubRef,
      pendingPayments,
      removePendingPayment,
      respondToBankPaymentOfferWithGroupState,
      selectedChatContact,
      selectedContact,
      sendChatMessage,
      setContactsOnboardingHasPaid,
      updateLocalNostrMessage,
    },
    formatDisplayedAmountParts,
    formatDisplayedAmountText,
    identity: {
      appOwnerId,
      appOwnerIdRef,
      cashuOwnerId,
      cashuOwnerIdRef,
      cashuVisibleOwnerIds,
      currentNpub,
      currentNsec,
      isSeedLogin,
      metaOwnerId,
      transactionsOwnerId,
    },
    maybeShowPwaNotification,
    ownerScopedStorage: {
      logPaymentEvent,
      makeLocalStorageKey,
      migrateLegacyPaymentEventsToEvolu,
      readSeenMintsFromStorage,
      rememberSeenMint,
    },
    payAmount,
    profile: {
      npubCashInfoInFlightRef,
      npubCashInfoLoadedAtMsRef,
      npubCashInfoLoadedForNpubRef,
      setIsProfileEditing,
      setMyProfileQr,
      setOwnedProfileLightningAddresses,
      setOwnedProfileLightningAddressesLoading,
    },
    pushToast,
    route,
    setContactPaymentIntent,
    setPayAmount,
    setStatus,
    t,
    update,
    upsert,
  });

  useArmedDeleteTimeouts({
    pendingCashuDeleteId,
    pendingDeleteId,
    pendingEvoluServerDeleteUrl,
    pendingMintDeleteUrl,
    setPendingCashuDeleteId,
    setPendingDeleteId,
    setPendingEvoluServerDeleteUrl,
    setPendingMintDeleteUrl,
  });

  useAppPreferences({
    allowedDisplayCurrencies,
    decimalAmountInputEnabled,
    displayCurrency,
    bankPaymentOfferRecipientCount,
    bankPaymentOfferStaggerDelaySec,
    lightningInvoiceAutoPayLimit,
    payWithCashuEnabled,
    seenReceiptsEnabledAtSec,
    showProfileQrOnTiltEnabled,
  });

  const isMainSwipeRoute = route.kind === "contacts" || route.kind === "wallet";

  const { commitMainSwipe } = useMainSwipeNavigation({
    isMainSwipeRoute,
    mainSwipeRef,
    mainSwipeScrollTimerRef,
    routeKind: route.kind,
  });

  const clearPendingDeleteOnMenuChange = React.useCallback(() => {
    setPendingDeleteId(null);
  }, [setPendingDeleteId]);

  const { closeMenu, menuIsOpen, navigateToMainReturn, toggleMenu } =
    useMainMenuState({
      onClose: clearPendingDeleteOnMenuChange,
      onOpen: clearPendingDeleteOnMenuChange,
      route,
    });

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
    onScanImageSelected,
    onSubmitManualPayText,
    openIssueTokenFromScan,
    openManualContactFromScan,
    openManualPayFromScan,
    openReceiveScan,
    openScan,
    openWalletScan,
    pasteScanValue,
    scanAllowsManualContact,
    scanCameraLabel,
    scanCanSwitchCamera,
    scanEntryPoint,
    scanImageInputRef,
    scanIsOpen,
    scanVideoRef,
    shareCashuTokenText,
    shareOptionsText,
    shareOptionsViaEmail,
    shareOptionsViaSms,
    shareOptionsViaWhatsApp,
    showContactsOnboarding,
    stableContactsGuideNav,
    startContactsGuide,
    stopContactsGuide,
    writeCashuTokenToNfc,
    writeCurrentNpubToNfc,
  } = useScanNativeComposition({
    addNewContactFromIdentifier,
    cashuBalance,
    cashuOwnerId,
    cashuTokensAllFiltered,
    contacts,
    contactsLatestRef,
    contactsOnboardingDismissedSynced,
    contactsOnboardingHasBackedUpKeys,
    contactsOnboardingHasPaid,
    contactsOnboardingHasSentMessage,
    contactsOwnerId,
    copyText,
    currentNpub,
    currentNsec,
    dispatchInboxEvent,
    insert,
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
    route,
    saveCashuFromText,
    setPendingDeleteId,
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
          onMintIconLoad={handleMintIconLoad}
          onMintIconError={handleMintIconError}
        />
      );
    },
    [
      getCashuTokenMessageInfo,
      getMintIconUrl,
      getNpubMessageContactInfo,
      handleMintIconError,
      handleMintIconLoad,
      handleSelectContact,
      lastMessageByContactId,
      nostrPictureByNpub,
      nostrStatusByNpub,
      route,
      unreadByContactId,
    ],
  );

  const renderMainSwipeContactCard = React.useCallback(
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
      appOwnerId: contactsOwnerId,
      cashuOwnerId,
      cashuTokens: cashuTokensFiltered,
      cashuTokensAll: cashuTokensAllFiltered,
      contacts,
      importDataFileInputRef,
      insert,
      upsert,
      pushToast,
      t,
      update,
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
      const username = (effectiveProfileName ?? currentNpub ?? "").trim();
      if (!password || !username) return "failed";

      return triggerPasswordManagerSeedSave({
        displayName: username,
        password,
        username,
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
    if (nfcWritePromptKind && shouldRenderNativeNfcWritePrompt()) {
      return cancelPendingNfcWrite;
    }
    // The paid overlay hides every confirmation below it and clears itself on a
    // timer, so there is nothing for back to dismiss while it is up.
    if (paidOverlayIsOpen) return null;
    if (pendingPaymentMintMeltConfirmation) {
      return closePaymentMintMeltConfirmation;
    }
    if (pendingLnurlWithdrawConfirmation) {
      return closeLnurlWithdrawConfirmation;
    }
    if (pendingLightningInvoiceConfirmation) {
      return closeLightningInvoiceConfirmation;
    }
    if (postPaySaveContact) return () => setPostPaySaveContact(null);
    return null;
  })();

  useNativeBackHandler({
    closeMenu,
    closeScan,
    dismissTopModal,
    menuIsOpen,
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
  const topbarRight = React.useMemo(
    () =>
      buildTopbarRight({
        chatEditContactId,
        isProfileEditing,
        openReceiveScan,
        openScan,
        route,
        t,
        toggleMenu,
      }),
    [
      chatEditContactId,
      isProfileEditing,
      openReceiveScan,
      openScan,
      route,
      t,
      toggleMenu,
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
    nostrMessagesRecent,
    route,
    saveCashuFromText,
    selectedContact: selectedChatContact,
  });

  const moneyRouteProps = useMemoizedRouteBuilder(
    {
      canRestoreTokens: (seedMnemonic ?? "").trim().length > 0,
      canSendCashuTokenToContact: contacts.length > 0,
      canWriteNfc,
      canPayWithCashu,
      cashuBalance,
      cashuBalanceAfterMelt,
      cashuTotalBalance,
      cashuBulkCheckIsBusy,
      cashuDraft,
      cashuDraftRef,
      cashuEmitAmount,
      cashuHasMultipleAcceptedMints,
      cashuIsBusy,
      cashuIssuedTokens,
      cashuMeltToMainMintButtonLabel,
      cashuTokensAll: cashuTokensAllFiltered,
      cashuOwnTokens,
      cashuOwnSpentTokensCount: cashuOwnSpentTokens.length,
      bankPaymentOfferContacts,
      bankPaymentOfferRecipientCount,
      bankPaymentOfferStaggerDelaySec,
      deleteSpentCashuTokens,
      deleteSpentCashuTokensIsBusy,
      checkAllCashuTokensAndDeleteInvalid,
      checkAndRefreshCashuToken,
      checkIssuedCashuTokensAndDeleteClaimed,
      checkSingleIssuedCashuTokenIsClaimed,
      showPaidOverlay,
      copyText,
      currentNpub,
      displayUnit,
      emitCashuToken,
      getMintIconUrl,
      knownLnAddressPayContact,
      knownLnAddressPayContactPictureUrl,
      lnAddressPayAmount,
      manualPayContacts: contacts,
      manualPayNostrPictureByNpub: nostrPictureByNpub,
      onRequestBankPaymentOffer: requestBankPaymentOffer,
      onSubmitManualPayText,
      meltLargestForeignMintToMainMint,
      payLightningAddressWithCashu,
      pendingCashuDeleteId,
      restoreMissingTokens,
      reserveCashuToken,
      requestDeleteCashuToken,
      returnCashuTokenToWallet,
      startSendCashuTokenToContact,
      route,
      saveCashuFromText,
      setCashuEmitAmount,
      setCashuDraft,
      setLnAddressPayAmount,
      setMintIconUrlByMint,
      shareCashuTokenText,
      setTopupAmount,
      t,
      topupAmount,
      topupInvoice,
      topupInvoiceError,
      topupInvoiceIsBusy,
      topupInvoiceCashuRequest,
      topupMintUrl:
        topupMintUrl ??
        normalizeMintUrl(defaultMintUrl ?? MAIN_MINT_URL) ??
        MAIN_MINT_URL,
      topupInvoiceQr,
      topupInvoiceQrPayload,
      tokensRestoreIsBusy,
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
              contactCount: pendingContactsGroupAssignment.savedContacts.length,
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
      myProfileQr,
      profileStatusCurrencies,
      profileStatusIsSaving,
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
      cycleProfileAvatarControl,
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
      pendingDeleteId,
      reactionsByMessageId,
      profileCustomPictureUrl,
      profileEditLnAddress,
      profileEditName,
      profileEditPicture,
      profileEditStatus,
      profileEditsSavable,
      unregisteredOwnLightningAddress,
      profileStatus: myProfileStatus,
      profilePhotoInputRef,
      profileSelectedPictureKind,
      blockArchivedContact,
      selectedProfileStatusCurrencies,
      restoreArchivedContact: restoreEditingContact,
      restoreSelectedContact: restoreCurrentContact,
      requestDeleteCurrentContact,
      resetEditedContactFieldFromNostr,
      replyContext,
      saveClaimedLightningAddress,
      saveProfileEdits,
      selectedContact: peopleSelectedContact,
      selectedContactPublicProfile,
      sendChatImage,
      sendChatMessage: sendChatOrEditMessage,
      setChatDraft,
      setContactPayMethod,
      setForm,
      setMintIconUrlByMint,
      setPayAmount,
      setProfileEditLnAddress,
      setProfileEditName,
      setProfileEditStatus,
      t,
      toggleProfileStatusCurrency,
      writeCurrentNpubToNfc,
    },
    buildPeopleRouteProps,
  );

  const { mainSwipeRouteProps, pageClassNameWithSwipe } =
    useRoutingViewComposition({
      groupNamesCount: groupNames.length,
      isMainSwipeRoute,
      mainSwipeRouteBuilderInput: {
        activeGroup,
        bankPaymentOfferMessages,
        cashuTotalBalance,
        contactsOnboardingCelebrating,
        contactsOnboardingTasks,
        contactsSearch,
        contactsSearchInputRef,
        contactFilterOptions,
        conversationsLabel,
        dismissContactsOnboarding,
        dismissWalletWarning,
        handleMainSwipeTabChange: commitMainSwipe,
        mainSwipeRef,
        canAddContact,
        openNewContactPage,
        openProfileQr,
        openWalletScan,
        otherContactsLabel,
        renderContactCard: renderMainSwipeContactCard,
        route,
        scanIsOpen,
        showProfileQrOnTiltEnabled,
        setActiveGroup,
        setContactsSearch,
        showContactsOnboarding,
        showWalletWarning: walletWarningApplies && !walletWarningDismissed,
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
      copyNostrKeys,
      copySeed,
      passwordManagerSeedUsername: (
        effectiveProfileName ??
        currentNpub ??
        ""
      ).trim(),
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
      payWithCashuEnabled,
      pushToast,
      relayUrls,
      requestImportAppData,
      requestLogout,
      requestPasteNostrKeys,
      saveSeedToPasswordManager,
      seedMnemonic,
      setLightningInvoiceAutoPayLimit,
      setPayWithCashuEnabled,
    },
    evoluSettingsInput: {
      evoluCashuOwnerEditsUntilRotation: cashuOwnerEditsUntilRotation,
      evoluCashuOwnerId: cashuOwnerId,
      evoluCashuOwnerIndex: cashuOwnerIndex,
      evoluCashuVisibleOwnerIds: cashuVisibleOwnerIds,
      evoluContactsOwnerEditCount: contactsOwnerEditCount,
      evoluContactsOwnerEditsUntilRotation: contactsOwnerEditsUntilRotation,
      evoluContactsOwnerId: contactsOwnerId,
      evoluContactsOwnerIndex: contactsOwnerIndex,
      evoluContactsOwnerNewContactsCount: contactsOwnerNewContactsCount,
      evoluContactsOwnerPointer: contactsOwnerPointer,
      evoluDatabaseBytes: evoluDbInfo.info.bytes,
      evoluHasError,
      evoluErrorType: evoluLastError?.type ?? null,
      evoluHistoryAllowedOwnerIds,
      evoluHistoryCount: evoluDbInfo.info.historyCount,
      evoluMessagesOwnerEditsUntilRotation: messagesOwnerEditsUntilRotation,
      evoluMessagesOwnerId: messagesOwnerId,
      evoluMessagesOwnerIndex: messagesOwnerIndex,
      evoluMessagesVisibleOwnerIds: messagesVisibleOwnerIds,
      evoluServerStatusByUrl,
      evoluServerUrls,
      evoluServersReloadRequired,
      evoluTableCounts: evoluDbInfo.info.tableCounts,
      evoluTransactionsOwnerEditsUntilRotation:
        transactionsOwnerEditsUntilRotation,
      evoluTransactionsOwnerId: transactionsOwnerId,
      evoluTransactionsOwnerIndex: transactionsOwnerIndex,
      evoluTransactionsOwnerPointer: transactionsOwnerPointer,
      evoluTransactionsVisibleOwnerIds: transactionsVisibleOwnerIds,
      evoluWipeStorageIsBusy,
      isEvoluServerOffline,
      newEvoluServerUrl,
      pendingEvoluServerDeleteUrl,
      requestManualRotateCashuOwner,
      requestManualRotateContactsOwner,
      requestManualRotateMessagesOwner,
      requestManualRotateTransactionsOwner,
      rotateCashuOwnerIsBusy,
      rotateContactsOwnerIsBusy,
      rotateMessagesOwnerIsBusy,
      rotateTransactionsOwnerIsBusy,
      saveEvoluServerUrls,
      setEvoluServerOffline,
      setNewEvoluServerUrl,
      setPendingEvoluServerDeleteUrl,
      setStatus,
      syncOwner,
      wipeEvoluStorage,
    },
    mintSettingsInput: {
      appOwnerIdRef,
      applyDefaultMintSelection,
      cashuIsBusy,
      cashuMeltToMainMintButtonLabel,
      defaultMintUrl,
      defaultMintUrlDraft,
      getMintIconUrl,
      getMintRuntime,
      meltLargestForeignMintToMainMint,
      mintInfoByUrl,
      pendingMintDeleteUrl,
      probeLightningFee,
      refreshMintInfo,
      setDefaultMintUrlDraft,
      setMintInfoAll,
      setPendingMintDeleteUrl,
      setStatus,
    },
    relaySettingsInput: {
      canSaveNewRelay,
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

  const evoluTransactionsVisibleOwnerIds = React.useMemo(
    () => transactionsVisibleOwnerIds.map((ownerId) => ownerId),
    [transactionsVisibleOwnerIds],
  );

  const appState = React.useMemo(
    () => ({
      allowedDisplayCurrencies,
      applyAmountInputKey: applyDisplayedAmountInputKey,
      applyAmountInputKeyWithDraft: applyDisplayedAmountInputKeyWithDraft,
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
      decimalAmountInputKeyVisible,
      sendReadReceiptsEnabled: seenReceiptsEnabledAtSec !== null,
      displayCurrency,
      derivedProfile,
      displayUnit,
      effectiveMyLightningAddress,
      effectiveProfileName,
      effectiveProfilePicture,
      evoluAppOwnerId: appOwnerId ? appOwnerId : null,
      evoluTransactionsVisibleOwnerIds,
      formatDisplayedAmountParts,
      formatDisplayedAmountText,
      isProfileEditing,
      lang,
      menuIsOpen,
      myProfileQr,
      nfcWritePromptKind,
      nostrPictureByNpub,
      paidOverlayIsOpen,
      paidOverlayTitle,
      pendingPaymentMintMeltConfirmation,
      pendingLnurlWithdrawConfirmation,
      pendingLightningInvoiceConfirmation,
      postPaySaveContact,
      profileCustomPictureUrl,
      profileEditInitialRef,
      profileEditLnAddress,
      profileEditName,
      profileEditPicture,
      profileEditStatus,
      profileEditsSavable,
      profileStatus: myProfileStatus,
      profileStatusCurrencies,
      profileStatusIsSaving,
      profilePhotoInputRef,
      selectedProfileStatusCurrencies,
      profileSelectedPictureKind,
      route,
      scanAllowsManualContact,
      scanCameraLabel,
      scanCanSwitchCamera,
      scanEntryPoint,
      scanImageInputRef,
      scanIsOpen,
      shareOptionsText,
      scanVideoRef,
      t,
      topbar,
      topbarRight,
      topbarTitle,
      lnurlWithdrawIsBusy,
    }),
    [
      allowedDisplayCurrencies,
      applyDisplayedAmountInputKey,
      applyDisplayedAmountInputKeyWithDraft,
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
      decimalAmountInputKeyVisible,
      seenReceiptsEnabledAtSec,
      derivedProfile,
      displayCurrency,
      displayUnit,
      effectiveMyLightningAddress,
      effectiveProfileName,
      effectiveProfilePicture,
      evoluTransactionsVisibleOwnerIds,
      formatDisplayedAmountParts,
      formatDisplayedAmountText,
      isProfileEditing,
      lang,
      lnurlWithdrawIsBusy,
      menuIsOpen,
      myProfileQr,
      myProfileStatus,
      nfcWritePromptKind,
      nostrPictureByNpub,
      paidOverlayIsOpen,
      paidOverlayTitle,
      pendingLightningInvoiceConfirmation,
      pendingLnurlWithdrawConfirmation,
      pendingPaymentMintMeltConfirmation,
      postPaySaveContact,
      profileCustomPictureUrl,
      profileEditInitialRef,
      profileEditLnAddress,
      profileEditName,
      profileEditPicture,
      profileEditStatus,
      profileEditsSavable,
      profilePhotoInputRef,
      profileSelectedPictureKind,
      profileStatusCurrencies,
      profileStatusIsSaving,
      route,
      scanAllowsManualContact,
      scanCameraLabel,
      scanCanSwitchCamera,
      scanEntryPoint,
      scanImageInputRef,
      scanIsOpen,
      scanVideoRef,
      selectedProfileStatusCurrencies,
      shareOptionsText,
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
      closeLnurlWithdrawConfirmation,
      closeMenu,
      closeShareOptions,
      closeLightningInvoiceConfirmation,
      closeScan,
      confirmPaymentMintMelt,
      confirmLnurlWithdraw,
      confirmLightningInvoicePayment,
      contactsGuideNav: stableContactsGuideNav,
      copyShareOptionsText,
      copyText,
      cycleScanCamera,
      cycleDisplayCurrency,
      cycleProfileAvatarControl,
      onPickProfilePhoto,
      onPickScanImage,
      onProfilePhotoError,
      onProfilePhotoSelected,
      onScanImageSelected,
      openFeedbackContact,
      openIssueTokenFromScan,
      openManualContactFromScan,
      openManualPayFromScan,
      openProfileQr,
      openReceiveScan,
      openWalletScan,
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
      toggleProfileStatusCurrency,
      toggleSendReadReceipts,
      writeCurrentNpubToNfc,
    }),
    [
      cancelPendingNfcWrite,
      closeLightningInvoiceConfirmation,
      closeLnurlWithdrawConfirmation,
      closeMenu,
      closePaymentMintMeltConfirmation,
      closeScan,
      closeShareOptions,
      confirmLightningInvoicePayment,
      confirmLnurlWithdraw,
      confirmPaymentMintMelt,
      stableContactsGuideNav,
      copyShareOptionsText,
      copyText,
      cycleScanCamera,
      cycleDisplayCurrency,
      cycleProfileAvatarControl,
      onPickProfilePhoto,
      onPickScanImage,
      onProfilePhotoError,
      onProfilePhotoSelected,
      onScanImageSelected,
      openFeedbackContact,
      openIssueTokenFromScan,
      openManualContactFromScan,
      openManualPayFromScan,
      openProfileQr,
      openReceiveScan,
      openWalletScan,
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
      toggleProfileStatusCurrency,
      toggleSendReadReceipts,
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
    isMainSwipeRoute,
    lang,
    mainSwipeRouteProps,
    moneyRouteProps,
    pageClassNameWithSwipe,
    peopleRouteProps,
    pendingCashuContactSend,
    pushToast,
    route,
    setLang,
    advancedSettingsContext,
    evoluSettingsContext,
    mintSettingsContext,
    relaySettingsContext,
    t,
    toasts,
  };
};
