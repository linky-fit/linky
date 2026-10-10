import type { ProfileMetadata } from "@linky-fit/linkstr";
import React from "react";
import { useToasts } from "../hooks/useToasts";
import { takeAddContactHashLink } from "../sharedProfileLink";
import { takeSiteLoginHashLink } from "../siteLogin";
import {
  PENDING_DEEP_LINK_TEXT_STORAGE_KEY,
  PENDING_SHARED_PROFILE_NPUB_STORAGE_KEY,
} from "../utils/constants";
import { safeLocalStorageSet } from "../utils/storage";
import type { IdentityChangeMessageSource } from "./lib/identityChangeMessage";
import { useAppLanguage } from "./hooks/useAppLanguage";
import { useProfileAuthDomain } from "./hooks/useProfileAuthDomain";

export const useUnauthenticatedAppShellComposition = () => {
  const { dismissToast, pushToast, toasts } = useToasts();
  const { lang, setLang, t } = useAppLanguage();

  // The signed-in shell reads the pending links on mount, so a web link opened
  // before onboarding runs right after it.
  React.useEffect(() => {
    const siteLoginLink = takeSiteLoginHashLink();
    if (siteLoginLink) {
      safeLocalStorageSet(PENDING_DEEP_LINK_TEXT_STORAGE_KEY, siteLoginLink);
    }
    const sharedProfileNpub = takeAddContactHashLink();
    if (sharedProfileNpub) {
      safeLocalStorageSet(
        PENDING_SHARED_PROFILE_NPUB_STORAGE_KEY,
        sharedProfileNpub,
      );
    }
  }, []);

  const appendIdentityChangeNoticesRef = React.useRef<
    | ((args: {
        changedAtSec: number;
        identitySource: IdentityChangeMessageSource;
      }) => void)
    | null
  >(null);
  const myProfileMetadataRef = React.useRef<ProfileMetadata | null>(null);
  const onboarding = useProfileAuthDomain({
    appendIdentityChangeNoticesRef,
    currentNsec: null,
    identityRepository: null,
    inboxCursors: null,
    lang,
    myProfileMetadataRef,
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
    pasteReturningSlip39FromClipboard:
      onboarding.pasteReturningSlip39FromClipboard,
    pickPendingOnboardingPhoto: onboarding.pickPendingOnboardingPhoto,
    savePendingOnboardingBackupToPasswordManager:
      onboarding.savePendingOnboardingBackupToPasswordManager,
    selectReturningSlip39Suggestion: onboarding.selectReturningSlip39Suggestion,
    setLang,
    setOnboardingStep: onboarding.setOnboardingStep,
    setPendingOnboardingName: onboarding.setPendingOnboardingName,
    setReturningSlip39Input: onboarding.setReturningSlip39Input,
    submitReturningSlip39: onboarding.submitReturningSlip39,
    t,
    toasts,
  };
};
