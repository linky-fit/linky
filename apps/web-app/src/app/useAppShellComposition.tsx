import { createContactNameFormatter } from "../utils/contactName";
import { useMemoizedRouteBuilder } from "./hooks/composition/useMemoizedRouteBundle";
import { ContactId as ContactIdType } from "@linky-fit/linksync";
import { useAtom, useAtomSet, useAtomValue } from "@linky-fit/linkstr-react";
import React from "react";
import { ContactCard } from "../components/ContactCard";
import type { ContactId } from "../evolu";
import { navigateTo, useRouting } from "../hooks/useRouting";
import { useToasts } from "../hooks/useToasts";
import { reportAppLog } from "../devtools/inspector/appLog";
import { shouldRenderNativeNfcWritePrompt } from "../platform/nativeBridge";
import { normalizeNpubIdentifier } from "../utils/nostrNpub";
import { useCashuWalletComposition } from "./hooks/composition/useCashuWalletComposition";
import { logPayStep } from "./state/wallet/paymentLog";
import { useContactsMessagingComposition } from "./hooks/composition/useContactsMessagingComposition";
import {
  useNpubMessageContactInfo,
  type DisplayContact,
} from "./hooks/contacts/useDisplayContacts";
import { useEffectiveProfile } from "./hooks/profile/useEffectiveProfile";
import { useMintIcons } from "./hooks/mint/useMintInfo";
import { contactNewPrefillAtom } from "./state/contacts/contactForm";
import { useIdentityOwnersComposition } from "./hooks/composition/useIdentityOwnersComposition";
import { buildMoneyRouteProps } from "./routes/props/buildMoneyRouteProps";
import { useProfileComposition } from "./hooks/composition/useProfileComposition";
import { buildPeopleRouteProps } from "./routes/props/buildPeopleRouteProps";
import { useRoutingViewComposition } from "./hooks/composition/useRoutingViewComposition";
import { useScanNativeComposition } from "./hooks/composition/useScanNativeComposition";
import { useEvoluStorageWatchers } from "./hooks/settings/useEvoluStorageWatchers";
import { useProvideOwnerCommands } from "./hooks/shell/ownerCommands";
import { scanCommandsAtom } from "./state/shell/scan";
import { useMainMenuState } from "./hooks/layout/useMainMenuState";
import { useNativeBackHandler } from "./hooks/layout/useNativeBackHandler";
import { useChatMessageEffects } from "./hooks/messages/useChatMessageEffects";
import { useAppLanguage } from "./hooks/useAppLanguage";
import { useDisplayCurrencyGuard } from "./hooks/settings/useDeviceSettings";
import { useAppPreferences } from "./hooks/useAppPreferences";
import { useTopDownTilt } from "./hooks/useTopDownTilt";
import { useFiatRatesSync } from "./hooks/useFiatRates";
import { useCopyText, useDisplayAmounts, useSetStatus } from "./hooks/shell";
import { useNavIntent } from "./hooks/shell/navIntents";
import { showProfileQrOnTiltAtom } from "./state/shell/devicePrefs";
import { profileShareOverlayOpenAtom } from "./state/shell/overlays";
import { hiddenTransactionsShownAtom } from "./state/shell/topbar";
import { useLnurlAuth } from "./hooks/useLnurlAuth";
import { useSiteLogin } from "./hooks/useSiteLogin";
import {
  useContactsRepository,
  useConversationsRepository,
  useSetting,
  useSettingsRepository,
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
    appOwnerId,
    currentNpub,
    isSeedLogin,
    pendingIdentitySwitch,
    seedMnemonic,
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
  const setStatus = useSetStatus();
  useEvoluStorageWatchers(route);

  useDisplayCurrencyGuard();
  const [profileShareOverlayIsOpen, setProfileShareOverlayIsOpen] = useAtom(
    profileShareOverlayOpenAtom,
  );
  const closeProfileShareOverlay = React.useCallback(() => {
    setProfileShareOverlayIsOpen(false);
  }, [setProfileShareOverlayIsOpen]);
  const showProfileQrOnTiltEnabled = useAtomValue(showProfileQrOnTiltAtom);

  useFiatRatesSync();
  const {
    displayUnit,
    fiatRates,
    formatDisplayedAmountParts,
    formatDisplayedAmountText,
  } = useDisplayAmounts();

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

  useStatusToasts();

  const copyText = useCopyText();

  const {
    activeBankPaymentOfferContacts,
    activeGroup,
    addNewContactFromIdentifier,
    appendLocalNostrMessage,
    autoAcceptedChatMessageIdsRef,
    bankPaymentOfferContacts,
    bankPaymentOfferRecipientCount,
    bankPaymentOfferStaggerDelaySec,
    chatDidInitialScrollForContactRef,
    chatForceScrollToBottomRef,
    chatLastMessageCountRef,
    chatMessageElByIdRef,
    chatMessages,
    chatMessagesRef,
    chatMessagesWithBankPaymentOffers,
    chatScrollTargetIdRef,
    closeContactDetail,
    contactFilterOptions,
    contacts,
    contactsFilterOpen,
    contactsLatestRef,
    contactsOnboardingHasBackedUpKeys,
    contactsOnboardingHasPaid,
    contactsOnboardingHasSentMessage,
    contactsSearch,
    contactsSearchInputRef,
    dispatchInboxEvent,
    displayContactById,
    getBankPaymentOfferForSettlement,
    groupNames,
    isBankPaymentOfferCanceled,
    lastMessageByContactId,
    latestMessages,
    nostrBootstrapReady,
    nostrMessagesLocal,
    nostrMessagesRecent,
    nostrMetadataByNpub,
    nostrPictureByNpub,
    nostrStatusByNpub,
    openContactDetail,
    openFeedbackContact,
    openNewContactPage,
    pendingPaymentsKey,
    requestBankPaymentOffer,
    respondToBankPaymentOfferWithGroupState,
    saveNpubContact,
    selectedChatContact,
    selectedContact,
    sendChatMessage,
    setActiveGroup,
    setContactsSearch,
    statusFilterCurrencies,
    toggleContactsFilter,
    ungroupedCount,
    unreadByContactId,
    updateLocalNostrMessage,
    visibleContacts,
  } = useContactsMessagingComposition({
    appOwnerId,
    contactsRepository,
    conversationsRepository,
    currentNpub,
    currentNsec,
    formatDisplayedAmountText,
    isSeedLogin,
    lang,
    logPayStep,
    maybeShowPwaNotification,
    pushToast,
    route,
    setStatus,
    syncedNostrIdentityMatchesLocal,
    t,
  });

  const {
    isProfileEditing,
    npubCashInfoInFlightRef,
    npubCashInfoLoadedAtMsRef,
    npubCashInfoLoadedForNpubRef,
    setIsProfileEditing,
    setOwnedProfileLightningAddresses,
    setOwnedProfileLightningAddressesLoading,
  } = useProfileComposition({
    currentNpub,
    nostrMetadataByNpub,
    nostrPictureByNpub,
    nostrStatusByNpub,
    nostrBootstrapReady,
    route,
  });
  const { effectiveProfileName, effectiveProfilePicture } =
    useEffectiveProfile();
  const openProfileQr = React.useCallback(() => {
    navigateTo({ route: "profile" });
  }, []);
  const setContactNewPrefill = useAtomSet(contactNewPrefillAtom);

  const {
    cancelPendingCashuContactSend,
    cashuBalance,
    cashuBalanceAfterMelt,
    cashuIsBusy,
    cashuTokensHydratedRef,
    cashuTransfers,
    closeCashuPaymentRequestConfirmation,
    closeLightningInvoiceConfirmation,
    closeLnurlWithdrawConfirmation,
    closePaymentMintMeltConfirmation,
    confirmCashuPaymentRequest,
    confirmLightningInvoicePayment,
    confirmLnurlWithdraw,
    confirmPaymentMintMelt,
    getCashuTokenMessageInfo,
    isCashuTokenKnownAny,
    isCashuTokenStored,
    lightningInvoiceAutoPayLimit,
    lnurlWithdrawIsBusy,
    markCashuTokenExternalized,
    markCashuTokenIssued,
    onPayChatPaymentRequest,
    paidOverlayDetails,
    paidOverlayIsOpen,
    paidOverlayPhase,
    paidOverlayTitle,
    payCashuPaymentRequest,
    payLightningAddressWithCashu,
    payLightningInvoiceWithCashu,
    paySelectedContact,
    pendingCashuContactSend,
    pendingCashuPaymentRequestConfirmation,
    pendingCashuTokenContactPickId,
    pendingLightningInvoiceConfirmation,
    pendingLnurlWithdrawConfirmation,
    pendingPaymentMintMeltConfirmation,
    postPaySaveContact,
    requestSelectedContact,
    restoreMissingTokens,
    reclaimHandedOutTokens,
    restoreAndReclaimAllTokens,
    saveCashuFromText,
    sendCashuTokenToContact,
    setLightningInvoiceAutoPayLimit,
    setPendingLightningInvoiceConfirmation,
    setPendingLnurlWithdrawConfirmation,
    setPostPaySaveContact,
    settleBankPaymentOffer,
  } = useCashuWalletComposition({
    copyText,
    contactsMessaging: {
      saveNpubContact,
      appendLocalNostrMessage,
      chatMessages,
      contacts,
      getBankPaymentOfferForSettlement,
      isBankPaymentOfferCanceled,
      nostrBootstrapReady,
      latestMessages,
      nostrMessagesLocal,
      nostrMessagesRecent,
      nostrPictureByNpub,
      pendingPaymentsKey,
      respondToBankPaymentOfferWithGroupState,
      selectedChatContact,
      selectedContact,
      sendChatMessage,
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
    setStatus,
    t,
    transactions,
  });

  useAppPreferences({
    bankPaymentOfferRecipientCount,
    bankPaymentOfferStaggerDelaySec,
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

  useProvideOwnerCommands(scanCommandsAtom, {
    closeScan,
    cycleScanCamera,
    handleScannedText: onSubmitManualPayText,
    onPickScanImage,
    openReceiveScan,
    openScan,
    openWalletScan,
    pasteScanValue,
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

  const getNpubMessageContactInfo = useNpubMessageContactInfo();
  const { getMintIconUrl, markMintIconFailed } = useMintIcons();

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

  const contactPayBackToChatId = useNavIntent("contactPayBackToChat");
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
      canWriteNfc,
      onRequestBankPaymentOffer: requestBankPaymentOffer,
      onSubmitManualPayText,
      openWalletScan,
      pasteScanValue,
      payLightningAddressWithCashu,
      reclaimHandedOutTokens,
      restoreAndReclaimAllTokens,
      restoreMissingTokens,
      saveCashuFromText,
      shareCashuTokenText,
      writeCashuTokenToNfc,
    },
    buildMoneyRouteProps,
  );

  const peopleRouteProps = useMemoizedRouteBuilder(
    {
      canWriteNfc,
      getMintIconUrl,
      markMintIconFailed,
      onPayPaymentRequest: onPayChatPaymentRequest,
      onRespondBankPaymentOffer: respondToBankPaymentOfferWithGroupState,
      onSettleBankPaymentOffer: settleBankPaymentOffer,
      payLightningInvoiceWithCashu,
      paySelectedContact,
      requestSelectedContact,
      shareText,
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

  const appState = React.useMemo(
    () => ({
      cashuBalance,
      cashuBalanceAfterMelt,
      cashuIsBusy,
      chatTopbarContact,
      contactsGuide,
      contactsGuideActiveStep,
      contactsGuideHighlightRect,
      currentNpub,
      currentNsec,
      effectiveProfileName,
      effectiveProfilePicture,
      evoluAppOwnerId: appOwnerId ? appOwnerId : null,
      fiatRates,
      formatDisplayedAmountParts,
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
      profileShareOverlayIsOpen,
      route,
      scanAllowsManualContact,
      scanDiagnostics,
      scanCanSwitchCamera,
      scanEntryPoint,
      scanIsOpen,
      shareOptionsText,
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
      appOwnerId,
      cashuBalance,
      cashuBalanceAfterMelt,
      cashuIsBusy,
      chatTopbarContact,
      contactsGuide,
      contactsGuideActiveStep,
      contactsGuideHighlightRect,
      currentNpub,
      currentNsec,
      effectiveProfileName,
      effectiveProfilePicture,
      fiatRates,
      formatDisplayedAmountParts,
      lang,
      lnurlAuthIsBusy,
      lnurlAuthIsDone,
      lnurlWithdrawIsBusy,
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
      route,
      scanAllowsManualContact,
      scanDiagnostics,
      scanCanSwitchCamera,
      scanEntryPoint,
      scanIsOpen,
      scanVideoRef,
      shareOptionsText,
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
      onPickScanImage,
      openFeedbackContact,
      openIssueTokenFromScan,
      openManualContactFromScan,
      openManualPayFromScan,
      openProfileQr,
      openReceiveScan,
      pasteScanValue,
      setContactNewPrefill,
      setLightningInvoiceAutoPayLimit,
      setPostPaySaveContact,
      stopContactsGuide,
      shareOptionsViaEmail,
      shareOptionsViaSms,
      shareOptionsViaWhatsApp,
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
      onPickScanImage,
      openFeedbackContact,
      openIssueTokenFromScan,
      openManualContactFromScan,
      openManualPayFromScan,
      openProfileQr,
      openReceiveScan,
      pasteScanValue,
      setContactNewPrefill,
      setLightningInvoiceAutoPayLimit,
      setPostPaySaveContact,
      shareOptionsViaEmail,
      shareOptionsViaSms,
      shareOptionsViaWhatsApp,
      stopContactsGuide,
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
    t,
    toasts,
  };
};
