import type { ProfileMetadata } from "@linky/linkstr";
import React from "react";
import {
  deriveDefaultLightningAddress,
  deriveDefaultProfile,
} from "../../../derivedProfile";
import type { Lang } from "../../../i18n";
import { navigateTo, type useRouting } from "../../../hooks/useRouting";
import { getBestNostrName } from "../../../utils/formatting";
import { normalizeNpubIdentifier } from "../../../utils/nostrNpub";
import { getInitialShowProfileQrOnTiltEnabled } from "../../../utils/storage";
import { usePortraitOrientationLock } from "../usePortraitOrientationLock";
import { useProfileEditor } from "../profile/useProfileEditor";
import { useProfileStatusEditor } from "../profile/useProfileStatusEditor";
import type { Translate } from "../../../i18n";

interface UseProfileCompositionParams {
  currentNpub: string | null;
  currentNsec: string | null;
  lang: Lang;
  /** Watch-fed per-npub maps from the messaging composition. */
  nostrMetadataByNpub: Record<string, ProfileMetadata | null>;
  nostrPictureByNpub: Record<string, string | null>;
  nostrStatusByNpub: Record<string, string | null>;
  route: ReturnType<typeof useRouting>;
  setStatus: React.Dispatch<React.SetStateAction<string | null>>;
  t: Translate;
}

export const useProfileComposition = ({
  currentNpub,
  currentNsec,
  lang,
  nostrMetadataByNpub,
  nostrPictureByNpub,
  nostrStatusByNpub,
  route,
  setStatus,
  t,
}: UseProfileCompositionParams) => {
  const [showProfileQrOnTiltEnabled] = React.useState<boolean>(() =>
    getInitialShowProfileQrOnTiltEnabled(),
  );
  const [myProfileName, setMyProfileName] = React.useState<string | null>(null);
  const [myProfilePicture, setMyProfilePicture] = React.useState<string | null>(
    null,
  );
  const [myProfileQr, setMyProfileQr] = React.useState<string | null>(null);
  const [myProfileLnAddress, setMyProfileLnAddress] = React.useState<
    string | null
  >(null);
  const [ownedProfileLightningAddresses, setOwnedProfileLightningAddresses] =
    React.useState<string[]>([]);
  const [
    ownedProfileLightningAddressesLoading,
    setOwnedProfileLightningAddressesLoading,
  ] = React.useState(true);
  const [myProfileStatus, setMyProfileStatus] = React.useState<string | null>(
    null,
  );
  const [myProfileMetadata, setMyProfileMetadata] =
    React.useState<ProfileMetadata | null>(null);

  const npubCashInfoInFlightRef = React.useRef(false);
  const npubCashInfoLoadedForNpubRef = React.useRef<string | null>(null);
  const npubCashInfoLoadedAtMsRef = React.useRef<number>(0);

  usePortraitOrientationLock(showProfileQrOnTiltEnabled);

  const defaultLightningAddress = React.useMemo(() => {
    if (!currentNpub) return null;
    return deriveDefaultLightningAddress(currentNpub);
  }, [currentNpub]);

  const derivedProfile = React.useMemo(() => {
    if (!currentNpub) return null;
    return deriveDefaultProfile(currentNpub, lang);
  }, [currentNpub, lang]);

  const effectiveProfileName = myProfileName ?? derivedProfile?.name ?? null;
  const effectiveProfilePicture =
    myProfilePicture ?? derivedProfile?.pictureUrl ?? null;

  const effectiveMyLightningAddress =
    myProfileLnAddress ?? defaultLightningAddress;

  const {
    cycleProfileAvatarControl,
    isProfileEditing,
    onPickProfilePhoto,
    onProfilePhotoError,
    onProfilePhotoSelected,
    profileCustomPictureUrl,
    profileEditInitialRef,
    profileEditLnAddress,
    profileEditName,
    profileEditPicture,
    profileEditStatus,
    profileEditsSavable,
    profilePhotoInputRef,
    profileSelectedPictureKind,
    saveClaimedLightningAddress,
    saveProfileEdits,
    setIsProfileEditing,
    setProfileEditLnAddress,
    setProfileEditName,
    setProfileEditStatus,
    toggleProfileEditing,
    unregisteredOwnLightningAddress,
  } = useProfileEditor({
    currentNpub,
    currentNsec,
    defaultLightningAddress,
    effectiveMyLightningAddress,
    effectiveProfileName,
    effectiveProfilePicture,
    myProfileMetadata,
    myProfileStatus,
    ownedLightningAddresses: ownedProfileLightningAddresses,
    ownedLightningAddressesLoading: ownedProfileLightningAddressesLoading,
    setMyProfileLnAddress,
    setMyProfileMetadata,
    setMyProfileName,
    setMyProfilePicture,
    setMyProfileStatus,
    setStatus,
    t,
  });

  // The own pubkey is part of the profile watch; mirror its map entries into
  // the my-profile state the editor also writes optimistically.
  const ownNpub = React.useMemo(
    () => normalizeNpubIdentifier(currentNpub ?? ""),
    [currentNpub],
  );
  const watchedMetadata = ownNpub
    ? (nostrMetadataByNpub[ownNpub] ?? null)
    : null;
  const watchedPicture =
    ownNpub && ownNpub in nostrPictureByNpub
      ? (nostrPictureByNpub[ownNpub] ?? null)
      : undefined;
  const watchedStatus =
    ownNpub && ownNpub in nostrStatusByNpub
      ? (nostrStatusByNpub[ownNpub] ?? null)
      : undefined;

  React.useEffect(() => {
    if (!watchedMetadata) return;
    setMyProfileMetadata(watchedMetadata);
    const bestName = getBestNostrName(watchedMetadata);
    if (bestName) setMyProfileName(bestName);
    const ln =
      (watchedMetadata.lud16 ?? "").trim() ||
      (watchedMetadata.lud06 ?? "").trim();
    setMyProfileLnAddress(ln || null);
  }, [
    setMyProfileLnAddress,
    setMyProfileMetadata,
    setMyProfileName,
    watchedMetadata,
  ]);

  React.useEffect(() => {
    if (watchedPicture === undefined) return;
    setMyProfilePicture(watchedPicture);
  }, [setMyProfilePicture, watchedPicture]);

  React.useEffect(() => {
    if (watchedStatus === undefined) return;
    setMyProfileStatus(watchedStatus);
  }, [setMyProfileStatus, watchedStatus]);

  const {
    profileStatusCurrencies,
    profileStatusIsSaving,
    selectedProfileStatusCurrencies,
    toggleProfileStatusCurrency,
  } = useProfileStatusEditor({
    currentNpub,
    currentNsec,
    myProfileStatus,
    setMyProfileStatus,
    setStatus,
    t,
  });

  React.useEffect(() => {
    if (route.kind !== "profileEdit") {
      return;
    }

    if (!isProfileEditing) {
      toggleProfileEditing();
    }
  }, [isProfileEditing, route.kind, toggleProfileEditing]);

  const openProfileQr = React.useCallback(() => {
    navigateTo({ route: "profile" });
  }, []);

  return {
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
    ownedProfileLightningAddressesLoading,
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
  };
};
