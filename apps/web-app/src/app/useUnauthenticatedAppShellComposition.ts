import type { ProfileMetadata } from "@linky/linkstr";
import React from "react";
import { useEvolu } from "../evolu";
import { useToasts } from "../hooks/useToasts";
import type { IdentityChangeMessageSource } from "./lib/identityChangeMessage";
import { useAppLanguage } from "./hooks/useAppLanguage";
import { useProfileAuthDomain } from "./hooks/useProfileAuthDomain";

export const useUnauthenticatedAppShellComposition = () => {
  const { upsert } = useEvolu();
  const { dismissToast, pushToast, toasts } = useToasts();
  const { lang, setLang, t } = useAppLanguage();
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
    lang,
    myProfileMetadataRef,
    pushToast,
    t,
    upsert,
  });

  return {
    confirmPendingOnboardingProfile: onboarding.confirmPendingOnboardingProfile,
    createNewAccount: onboarding.createNewAccount,
    cyclePendingOnboardingAvatarControl:
      onboarding.cyclePendingOnboardingAvatarControl,
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
    selectPendingOnboardingGeneratedAvatar:
      onboarding.selectPendingOnboardingGeneratedAvatar,
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
