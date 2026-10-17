import React from "react";
import { useToasts } from "../hooks/useToasts";
import {
  subscribeAddContactHashLinks,
  subscribeScanHashLinks,
} from "../platform/hashLinks";
import { PENDING_SHARED_PROFILE_NPUB_STORAGE_KEY } from "../utils/constants";
import { safeLocalStorageSet } from "../utils/storage";
import { appendPendingDeepLink } from "./lib/pendingDeepLinks";
import { useAppLanguage } from "./hooks/useAppLanguage";
import { useProfileAuthDomain } from "./hooks/useProfileAuthDomain";

export const useUnauthenticatedAppShellComposition = () => {
  const { dismissToast, pushToast, toasts } = useToasts();
  const { lang, setLang, t } = useAppLanguage();

  // The signed-in shell reads the pending links on mount, so a web link opened
  // before onboarding runs right after it.
  React.useEffect(() => {
    const unsubscribeScan = subscribeScanHashLinks(appendPendingDeepLink);
    const unsubscribeAddContact = subscribeAddContactHashLinks((npub) =>
      safeLocalStorageSet(PENDING_SHARED_PROFILE_NPUB_STORAGE_KEY, npub),
    );
    return () => {
      unsubscribeScan();
      unsubscribeAddContact();
    };
  }, []);

  const onboarding = useProfileAuthDomain({
    currentNsec: null,
    identityRepository: null,
    inboxCursors: null,
    lang,
    pushToast,
    t,
  });

  return {
    confirmPendingOnboardingProfile: onboarding.confirmPendingOnboardingProfile,
    createNewAccount: onboarding.createNewAccount,
    shufflePendingOnboardingAvatar: onboarding.shufflePendingOnboardingAvatar,
    dismissToast,
    lang,
    onboardingIsBusy: onboarding.onboardingIsBusy,
    onboardingPhotoInputRef: onboarding.onboardingPhotoInputRef,
    onboardingStep: onboarding.onboardingStep,
    openReturningOnboarding: onboarding.openReturningOnboarding,
    onPendingOnboardingPhotoError: onboarding.onPendingOnboardingPhotoError,
    onPendingOnboardingPhotoSelected:
      onboarding.onPendingOnboardingPhotoSelected,
    pasteReturningSlip39: onboarding.pasteReturningSlip39,
    pasteReturningSlip39FromClipboard:
      onboarding.pasteReturningSlip39FromClipboard,
    pickPendingOnboardingPhoto: onboarding.pickPendingOnboardingPhoto,
    savePendingOnboardingBackupToPasswordManager:
      onboarding.savePendingOnboardingBackupToPasswordManager,
    setLang,
    setOnboardingStep: onboarding.setOnboardingStep,
    setPendingOnboardingName: onboarding.setPendingOnboardingName,
    setReturningSlip39Words: onboarding.setReturningSlip39Words,
    submitReturningSlip39: onboarding.submitReturningSlip39,
    t,
    toasts,
  };
};
