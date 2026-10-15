import { useAtom, useAtomSet, useAtomValue } from "@linky-fit/linkstr-react";
import React from "react";
import { reportAppLog } from "../devtools/inspector/appLog";
import { useRouting } from "../hooks/useRouting";
import { shouldRenderNativeNfcWritePrompt } from "../platform/nativeBridge";
import { useCashuWalletComposition } from "./hooks/composition/useCashuWalletComposition";
import { useContactsMessagingComposition } from "./hooks/composition/useContactsMessagingComposition";
import { useIdentityOwnersComposition } from "./hooks/composition/useIdentityOwnersComposition";
import { useProfileComposition } from "./hooks/composition/useProfileComposition";
import { useScanNativeComposition } from "./hooks/composition/useScanNativeComposition";
import {
  useBackFromContactNew,
  useCloseContactDetail,
} from "./hooks/contacts/useContactActions";
import { usePersistContactsOnboardingDismissed } from "./hooks/guide/useContactsOnboarding";
import {
  useMainMenu,
  useMainReturnTabWatcher,
} from "./hooks/layout/useMainMenuState";
import { useNativeBackHandler } from "./hooks/layout/useNativeBackHandler";
import { useChatMessageEffects } from "./hooks/messages/useChatMessageEffects";
import { useDisplayCurrencyGuard } from "./hooks/settings/useDeviceSettings";
import { useEvoluStorageWatchers } from "./hooks/settings/useEvoluStorageWatchers";
import { useIdentitySettings } from "./hooks/settings/useIdentitySettings";
import {
  useCopyText,
  useDisplayAmounts,
  usePaidOverlay,
  usePushToast,
  useSetStatus,
} from "./hooks/shell";
import { useLoginCommands } from "./hooks/shell/login";
import { useNavIntent } from "./hooks/shell/navIntents";
import { useCancelNfcWrite } from "./hooks/shell/nfc";
import { useProvideOwnerCommands } from "./hooks/shell/ownerCommands";
import { useScanCommands, useScanIsOpen } from "./hooks/shell/scan";
import { useShareOptions } from "./hooks/shell/share";
import { useAppLanguage } from "./hooks/useAppLanguage";
import { useAppPreferences } from "./hooks/useAppPreferences";
import { useFiatRatesSync } from "./hooks/useFiatRates";
import {
  useContactsRepository,
  useConversationsRepository,
  useSetting,
  useTransactionsRepository,
} from "./hooks/useLinksync";
import { useLnurlAuth } from "./hooks/useLnurlAuth";
import { useSiteLogin } from "./hooks/useSiteLogin";
import { useStatusToasts } from "./hooks/useStatusToasts";
import { useStoragePersistRequestEffect } from "./hooks/useStoragePersistRequestEffect";
import { useTopDownTilt } from "./hooks/useTopDownTilt";
import { useWalletCommands } from "./hooks/wallet/useWalletCommands";
import { useCashuTokenMessageInfo } from "./hooks/wallet/useWalletInventory";
import { showPwaNotification } from "./lib/pwaNotifications";
import { resolveBackAction } from "./lib/topbarConfig";
import {
  lnurlAuthDoneAtom,
  loginCommandsAtom,
  pendingCashuPaymentRequestAtom,
  pendingLightningInvoiceAtom,
  pendingLnurlAuthAtom,
  pendingLnurlWithdrawAtom,
  pendingPaymentMintMoveAtom,
  pendingSiteLoginAtom,
  postPaySaveContactAtom,
  siteLoginDoneAtom,
} from "./state/shell/confirmations";
import { showProfileQrOnTiltAtom } from "./state/shell/devicePrefs";
import {
  nfcWritePromptKindAtom,
  profileShareOverlayOpenAtom,
} from "./state/shell/overlays";
import { logPayStep } from "./state/wallet/paymentLog";

interface UseAppShellCompositionParams {
  currentNsec: string;
}

/**
 * The topmost dismissible modal in `AuthenticatedLayout`, or null.
 *
 * These modals are plain state rendered as siblings of the route content, so
 * nothing unmounts them on navigation — without this the Android back press
 * would move the route out from under an open payment confirmation and leave
 * its pending promise unresolved. Order is the reverse of the render order,
 * because the last sibling rendered is the one on top.
 */
const useDismissTopModal = (): (() => void) | null => {
  const share = useShareOptions();
  const [profileShareOverlayIsOpen, setProfileShareOverlayIsOpen] = useAtom(
    profileShareOverlayOpenAtom,
  );
  const nfcWritePromptKind = useAtomValue(nfcWritePromptKindAtom);
  const cancelNfcWrite = useCancelNfcWrite();
  const { paidOverlayIsOpen } = usePaidOverlay();
  const wallet = useWalletCommands();
  const login = useLoginCommands();
  const { answerPendingIdentitySwitch, pendingIdentitySwitch } =
    useIdentitySettings();
  const [postPaySaveContact, setPostPaySaveContact] = useAtom(
    postPaySaveContactAtom,
  );
  const lnurlAuthIsDone = useAtomValue(lnurlAuthDoneAtom);
  const siteLoginIsDone = useAtomValue(siteLoginDoneAtom);
  const pendingPaymentMintMove = useAtomValue(pendingPaymentMintMoveAtom);
  const pendingSiteLogin = useAtomValue(pendingSiteLoginAtom);
  const pendingLnurlAuth = useAtomValue(pendingLnurlAuthAtom);
  const pendingLnurlWithdraw = useAtomValue(pendingLnurlWithdrawAtom);
  const pendingLightningInvoice = useAtomValue(pendingLightningInvoiceAtom);
  const pendingCashuPaymentRequest = useAtomValue(
    pendingCashuPaymentRequestAtom,
  );

  if (share.shareOptionsText) return share.closeShareOptions;
  if (profileShareOverlayIsOpen) {
    return () => setProfileShareOverlayIsOpen(false);
  }
  if (nfcWritePromptKind && shouldRenderNativeNfcWritePrompt()) {
    return cancelNfcWrite;
  }
  // The paid overlay hides every confirmation below it and clears itself when
  // the payment ends, so there is nothing for back to dismiss while it is up.
  if (paidOverlayIsOpen || lnurlAuthIsDone || siteLoginIsDone) return null;
  if (pendingPaymentMintMove) return wallet.closePaymentMintMeltConfirmation;
  if (pendingSiteLogin) return login.closeSiteLoginConfirmation;
  if (pendingLnurlAuth) return login.closeLnurlAuthConfirmation;
  if (pendingLnurlWithdraw) return wallet.closeLnurlWithdrawConfirmation;
  if (pendingLightningInvoice) return wallet.closeLightningInvoiceConfirmation;
  if (pendingCashuPaymentRequest) {
    return wallet.closeCashuPaymentRequestConfirmation;
  }
  if (postPaySaveContact) return () => setPostPaySaveContact(null);
  if (pendingIdentitySwitch) {
    return () => void answerPendingIdentitySwitch(null);
  }
  return null;
};

/**
 * The signed-in shell's once-only watchers and the owners of commands that
 * keep their machinery in one place: identity, Evolu, messaging, wallet,
 * scanner and login signers. It also runs the Android back handler with its
 * modal priority, and tilt-to-show; screens read atoms and feature hooks.
 */
export const useAppShellComposition = ({
  currentNsec,
}: UseAppShellCompositionParams): void => {
  const route = useRouting();
  const pushToast = usePushToast();
  const { lang, t } = useAppLanguage();
  const {
    appOwnerId,
    currentNpub,
    isSeedLogin,
    syncedNostrIdentityMatchesLocal,
  } = useIdentityOwnersComposition({ currentNsec, lang, pushToast, t });

  const contactsRepository = useContactsRepository();
  const conversationsRepository = useConversationsRepository();
  const transactions = useTransactionsRepository();
  const setStatus = useSetStatus();
  const copyText = useCopyText();
  useEvoluStorageWatchers(route);
  useDisplayCurrencyGuard();
  useFiatRatesSync();
  useStoragePersistRequestEffect({ refreshKey: t });
  useStatusToasts();
  useAppPreferences();
  useMainReturnTabWatcher(route);
  const { fiatRates, formatDisplayedAmountParts, formatDisplayedAmountText } =
    useDisplayAmounts();

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

  const messaging = useContactsMessagingComposition({
    appOwnerId,
    contactsRepository,
    conversationsRepository,
    currentNpub,
    currentNsec,
    formatDisplayedAmountText,
    isSeedLogin,
    logPayStep,
    maybeShowPwaNotification,
    pushToast,
    route,
    setStatus,
    syncedNostrIdentityMatchesLocal,
    t,
  });

  const profile = useProfileComposition({
    currentNpub,
    nostrMetadataByNpub: messaging.nostrMetadataByNpub,
    nostrPictureByNpub: messaging.nostrPictureByNpub,
    nostrStatusByNpub: messaging.nostrStatusByNpub,
    nostrBootstrapReady: messaging.nostrBootstrapReady,
    route,
  });

  const wallet = useCashuWalletComposition({
    copyText,
    contactsMessaging: messaging,
    fiatRates,
    formatDisplayedAmountParts,
    identity: { appOwnerId, currentNpub, currentNsec },
    maybeShowPwaNotification,
    profile,
    pushToast,
    route,
    setStatus,
    t,
    transactions,
  });

  const lnurlAuth = useLnurlAuth({ currentNsec, setStatus, t });
  const siteLogin = useSiteLogin({ setStatus, t });
  useProvideOwnerCommands(loginCommandsAtom, {
    closeLnurlAuthConfirmation: lnurlAuth.closeLnurlAuthConfirmation,
    closeSiteLoginConfirmation: siteLogin.closeSiteLoginConfirmation,
    confirmLnurlAuth: lnurlAuth.confirmLnurlAuth,
    confirmSiteLogin: siteLogin.confirmSiteLogin,
  });

  const contactsOnboardingDismissedSynced =
    useSetting("onboardingTutorial") === "dismissed";
  const persistContactsOnboardingDismissed =
    usePersistContactsOnboardingDismissed();
  useScanNativeComposition({
    addNewContactFromIdentifier: messaging.addNewContactFromIdentifier,
    canPayCashuRequest: wallet.canPayCashuRequest,
    cashuBalance: wallet.cashuBalance,
    contacts: messaging.contacts,
    contactsLatestRef: messaging.contactsLatestRef,
    contactsOnboardingDismissedSynced,
    contactsOnboardingHasBackedUpKeys:
      messaging.contactsOnboardingHasBackedUpKeys,
    contactsOnboardingHasPaid: messaging.contactsOnboardingHasPaid,
    contactsOnboardingHasSentMessage:
      messaging.contactsOnboardingHasSentMessage,
    contactsRepository,
    currentNpub,
    currentNsec,
    dispatchInboxEvent: messaging.dispatchInboxEvent,
    lightningInvoiceAutoPayLimit: wallet.lightningInvoiceAutoPayLimit,
    nostrBootstrapReady: messaging.nostrBootstrapReady,
    openNewContactPage: messaging.openNewContactPage,
    payCashuPaymentRequest: wallet.payCashuPaymentRequest,
    payLightningInvoiceWithCashu: wallet.payLightningInvoiceWithCashu,
    persistContactsOnboardingDismissed,
    pushToast,
    requestLnurlAuthConfirmation: lnurlAuth.requestLnurlAuthConfirmation,
    requestLinkauthLogin: siteLogin.requestLinkauthLogin,
    requestSiteLoginConfirmation: siteLogin.requestSiteLoginConfirmation,
    route,
    saveCashuFromText: wallet.saveCashuFromText,
    setStatus,
    t,
  });

  const getCashuTokenMessageInfo = useCashuTokenMessageInfo();
  useChatMessageEffects({
    autoAcceptedChatMessageIdsRef: messaging.autoAcceptedChatMessageIdsRef,
    cashuIsBusy: wallet.cashuIsBusy,
    cashuTokensHydratedRef: wallet.cashuTokensHydratedRef,
    chatDidInitialScrollForContactRef:
      messaging.chatDidInitialScrollForContactRef,
    chatForceScrollToBottomRef: messaging.chatForceScrollToBottomRef,
    chatLastMessageCountRef: messaging.chatLastMessageCountRef,
    chatMessageElByIdRef: messaging.chatMessageElByIdRef,
    chatMessages: messaging.chatMessagesWithBankPaymentOffers,
    chatMessagesRef: messaging.chatMessagesRef,
    chatScrollTargetIdRef: messaging.chatScrollTargetIdRef,
    getCashuTokenMessageInfo,
    isCashuTokenKnownAny: wallet.isCashuTokenKnownAny,
    isCashuTokenStored: wallet.isCashuTokenStored,
    nostrBootstrapReady: messaging.nostrBootstrapReady,
    nostrMessagesRecent: messaging.nostrMessagesRecent,
    route,
    saveCashuFromText: wallet.saveCashuFromText,
    selectedContact: messaging.selectedChatContact,
  });

  const scanIsOpen = useScanIsOpen();
  const tiltEnabled = useAtomValue(showProfileQrOnTiltAtom);
  const setProfileShareOverlayIsOpen = useAtomSet(profileShareOverlayOpenAtom);
  useTopDownTilt({
    enabled: tiltEnabled && !scanIsOpen,
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

  const { closeScan } = useScanCommands();
  const { navigateToMainReturn } = useMainMenu();
  const closeContactDetail = useCloseContactDetail();
  const backFromContactNew = useBackFromContactNew();
  const contactPayBackToChatId = useNavIntent("contactPayBackToChat");
  const dismissTopModal = useDismissTopModal();
  useNativeBackHandler({
    closeScan,
    dismissTopModal,
    navigateBack: resolveBackAction(route, {
      backFromContactNew,
      closeContactDetail,
      contactPayBackToChatId,
      navigateToMainReturn,
    }),
    scanIsOpen,
  });
};
