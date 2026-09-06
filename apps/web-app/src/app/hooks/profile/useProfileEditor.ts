import { ProfileMetadata, StatusDraft } from "@linky/linkstr";
import {
  publishProfileAtom,
  publishStatusAtom,
  useAtomSet,
} from "@linky/linkstr-react";
import { Exit } from "effect";
import React from "react";
import {
  cycleGeneratedAvatar,
  deriveGeneratedAvatar,
  type AvatarEditorControlId,
  type DerivedAvatarSelection,
} from "../../../derivedProfile";
import { navigateTo } from "../../../hooks/useRouting";
import {
  buildProfileGeneralStatus,
  parseProfileGeneralStatus,
} from "../../../nostrStatus";
import {
  cacheProfileAvatarFromUrl,
  deleteCachedProfileAvatar,
  loadCachedProfile,
  saveCachedProfile,
  saveCachedStatus,
} from "../../../profileCache";
import { getBestNostrName } from "../../../utils/formatting";
import { getDefaultNip05IdentifierFromAddress } from "../../../utils/nostrNip05";
import {
  getOwnLightningAddressInputCandidate,
  type OwnLightningAddressInputCandidate,
} from "../../../utils/npubCashUsernameClaim";
import { isHttpUrl } from "../../../utils/validation";
import { applyLightningAddressToProfileMetadata } from "../../lib/profileMetadata";
import { nowSeconds } from "../../../utils/time";
import type { Translate } from "../../../i18n";

interface UseProfileEditorParams {
  currentNpub: string | null;
  currentNsec: string | null;
  defaultLightningAddress: string | null;
  effectiveMyLightningAddress: string | null;
  effectiveProfileName: string | null;
  effectiveProfilePicture: string | null;
  myProfileMetadata: ProfileMetadata | null;
  myProfileStatus: string | null;
  ownedLightningAddresses: readonly string[];
  ownedLightningAddressesLoading: boolean;
  setMyProfileLnAddress: React.Dispatch<React.SetStateAction<string | null>>;
  setMyProfileMetadata: React.Dispatch<
    React.SetStateAction<ProfileMetadata | null>
  >;
  setMyProfileName: React.Dispatch<React.SetStateAction<string | null>>;
  setMyProfilePicture: React.Dispatch<React.SetStateAction<string | null>>;
  setMyProfileStatus: React.Dispatch<React.SetStateAction<string | null>>;
  setStatus: React.Dispatch<React.SetStateAction<string | null>>;
  t: Translate;
}

interface PersistProfileValuesArgs {
  lightningAddress: string;
  name: string;
  navigateToProfile: boolean;
  picture: string;
  status: string;
}

export const useProfileEditor = ({
  currentNpub,
  currentNsec,
  defaultLightningAddress,
  effectiveMyLightningAddress,
  effectiveProfileName,
  effectiveProfilePicture,
  myProfileMetadata,
  myProfileStatus,
  ownedLightningAddresses,
  ownedLightningAddressesLoading,
  setMyProfileLnAddress,
  setMyProfileMetadata,
  setMyProfileName,
  setMyProfilePicture,
  setMyProfileStatus,
  setStatus,
  t,
}: UseProfileEditorParams) => {
  const [isProfileEditing, setIsProfileEditing] = React.useState(false);
  const [profileEditName, setProfileEditName] = React.useState("");
  const [profileEditLnAddress, setProfileEditLnAddress] = React.useState("");
  const [profileEditStatus, setProfileEditStatus] = React.useState("");
  const [profileEditPicture, setProfileEditPicture] = React.useState("");
  const [, setProfileAvatarSelection] = React.useState<DerivedAvatarSelection>(
    () => deriveGeneratedAvatar("linky").selection,
  );
  const [profileCustomPictureUrl, setProfileCustomPictureUrl] =
    React.useState("");
  const [profileSelectedPictureKind, setProfileSelectedPictureKind] =
    React.useState<"custom" | "generated">("generated");

  const profilePhotoInputRef = React.useRef<HTMLInputElement | null>(null);
  const profileEditInitialRef = React.useRef<{
    lnAddress: string;
    name: string;
    picture: string;
    status: string;
  } | null>(null);

  const toggleProfileEditing = React.useCallback(() => {
    if (isProfileEditing) {
      setIsProfileEditing(false);
      profileEditInitialRef.current = null;
      return;
    }

    const bestName = myProfileMetadata
      ? getBestNostrName(myProfileMetadata)
      : null;
    const initialName = bestName ?? effectiveProfileName ?? "";
    const initialLn = effectiveMyLightningAddress ?? "";

    const metaPic = (
      myProfileMetadata?.picture ??
      effectiveProfilePicture ??
      ""
    ).trim();

    const generatedAvatar = deriveGeneratedAvatar(currentNpub ?? initialName);
    const initialPicture = metaPic || generatedAvatar.pictureUrl;
    const customPicture =
      metaPic && metaPic !== generatedAvatar.pictureUrl ? metaPic : "";
    const initialStatus = parseProfileGeneralStatus(myProfileStatus).text ?? "";

    setProfileAvatarSelection(generatedAvatar.selection);
    setProfileCustomPictureUrl(customPicture);
    setProfileSelectedPictureKind(customPicture ? "custom" : "generated");
    setProfileEditName(initialName);
    setProfileEditLnAddress(initialLn);
    setProfileEditStatus(initialStatus);
    setProfileEditPicture(initialPicture);

    profileEditInitialRef.current = {
      name: initialName,
      lnAddress: initialLn,
      picture: initialPicture,
      status: initialStatus,
    };

    setIsProfileEditing(true);
  }, [
    effectiveMyLightningAddress,
    effectiveProfileName,
    effectiveProfilePicture,
    isProfileEditing,
    myProfileMetadata,
    myProfileStatus,
    currentNpub,
  ]);

  const profileEditsDirty = React.useMemo(() => {
    if (!isProfileEditing) return false;
    if (!profileEditInitialRef.current) return false;

    const initial = profileEditInitialRef.current;
    const name = profileEditName.trim();
    const ln = profileEditLnAddress.trim();
    const pic = profileEditPicture.trim();
    const status = profileEditStatus.trim();

    return (
      name !== initial.name.trim() ||
      ln !== initial.lnAddress.trim() ||
      pic !== initial.picture.trim() ||
      status !== initial.status.trim()
    );
  }, [
    isProfileEditing,
    profileEditLnAddress,
    profileEditName,
    profileEditPicture,
    profileEditStatus,
  ]);

  const profileEditsSavable =
    profileEditsDirty && Boolean(currentNpub && currentNsec);

  const ownLightningAddressInputCandidate = React.useMemo(() => {
    if (ownedLightningAddressesLoading) return null;
    return getOwnLightningAddressInputCandidate(profileEditLnAddress);
  }, [ownedLightningAddressesLoading, profileEditLnAddress]);

  const ownLightningAddressMatchesCurrentIdentity = React.useCallback(
    (candidate: OwnLightningAddressInputCandidate): boolean => {
      const normalizedDefault = (defaultLightningAddress ?? "")
        .trim()
        .toLowerCase();
      if (
        normalizedDefault &&
        candidate.lightningAddress === normalizedDefault
      ) {
        return true;
      }

      for (const lightningAddress of ownedLightningAddresses) {
        const normalizedOwned = lightningAddress.trim().toLowerCase();
        if (normalizedOwned && candidate.lightningAddress === normalizedOwned) {
          return true;
        }
      }

      return false;
    },
    [defaultLightningAddress, ownedLightningAddresses],
  );

  const unregisteredOwnLightningAddress = React.useMemo(() => {
    if (!ownLightningAddressInputCandidate) return null;
    if (
      ownLightningAddressMatchesCurrentIdentity(
        ownLightningAddressInputCandidate,
      )
    ) {
      return null;
    }
    return ownLightningAddressInputCandidate;
  }, [
    ownLightningAddressInputCandidate,
    ownLightningAddressMatchesCurrentIdentity,
  ]);

  const profileLightningAddressToPersist = React.useMemo(() => {
    if (
      ownLightningAddressInputCandidate &&
      ownLightningAddressMatchesCurrentIdentity(
        ownLightningAddressInputCandidate,
      )
    ) {
      return ownLightningAddressInputCandidate.lightningAddress;
    }

    return profileEditLnAddress;
  }, [
    ownLightningAddressInputCandidate,
    ownLightningAddressMatchesCurrentIdentity,
    profileEditLnAddress,
  ]);

  const publishProfile = useAtomSet(publishProfileAtom, {
    mode: "promiseExit",
  });
  const publishStatus = useAtomSet(publishStatusAtom, { mode: "promiseExit" });

  const persistProfileValues = React.useCallback(
    async ({
      lightningAddress,
      name,
      navigateToProfile,
      picture,
      status,
    }: PersistProfileValuesArgs): Promise<boolean> => {
      try {
        if (!currentNpub || !currentNsec) {
          setStatus(t("profileMissingNpub"));
          return false;
        }

        const trimmedName = name.trim();
        const trimmedLightningAddress = lightningAddress.trim();
        const nextNip05 = getDefaultNip05IdentifierFromAddress(
          trimmedLightningAddress,
        );
        const trimmedPicture = picture.trim();
        const trimmedStatus = status.trim();
        const nextStatus = buildProfileGeneralStatus({
          currencies: parseProfileGeneralStatus(myProfileStatus).currencies,
          text: status,
        });

        // The own pubkey is watched, so cache/state carry the newest profile.
        const prev =
          myProfileMetadata ?? loadCachedProfile(currentNpub)?.metadata ?? null;
        const keptNip05 =
          nextNip05 ??
          (getDefaultNip05IdentifierFromAddress(prev?.nip05 ?? "")
            ? undefined
            : prev?.nip05);

        const nextMetadata = new ProfileMetadata({
          ...(trimmedName
            ? { name: trimmedName, displayName: trimmedName }
            : {}),
          ...(trimmedLightningAddress
            ? {
                lud16: trimmedLightningAddress,
                ...(prev?.lud06 ? { lud06: prev.lud06 } : {}),
              }
            : {}),
          ...(keptNip05 ? { nip05: keptNip05 } : {}),
          ...(trimmedPicture ? { picture: trimmedPicture } : {}),
          ...(prev?.about ? { about: prev.about } : {}),
        });

        const statusExit = await publishStatus(
          new StatusDraft({ content: nextStatus ?? "" }),
        );
        if (Exit.isFailure(statusExit)) {
          throw new Error("status publish failed");
        }

        const profileExit = await publishProfile(nextMetadata);
        if (Exit.isFailure(profileExit)) throw new Error("publish failed");

        const nowSec = nowSeconds();
        saveCachedProfile(currentNpub, nextMetadata, nowSec);
        saveCachedStatus(currentNpub, nextStatus ?? "", nowSec);
        setMyProfileMetadata(nextMetadata);
        setMyProfileName(trimmedName || null);
        setMyProfileLnAddress(trimmedLightningAddress || null);
        setMyProfilePicture(trimmedPicture || null);
        setMyProfileStatus(nextStatus);
        setProfileEditName(trimmedName);
        setProfileEditLnAddress(trimmedLightningAddress);
        setProfileEditPicture(trimmedPicture);
        setProfileEditStatus(trimmedStatus);

        profileEditInitialRef.current = {
          lnAddress: trimmedLightningAddress,
          name: trimmedName,
          picture: trimmedPicture,
          status: trimmedStatus,
        };

        if (!trimmedPicture || !isHttpUrl(trimmedPicture)) {
          void deleteCachedProfileAvatar(currentNpub);
        } else {
          void cacheProfileAvatarFromUrl(currentNpub, trimmedPicture);
        }

        if (navigateToProfile) {
          setIsProfileEditing(false);
          profileEditInitialRef.current = null;
          navigateTo({ route: "profile" });
        }

        return true;
      } catch (error) {
        setStatus(`${t("errorPrefix")}: ${String(error ?? "unknown")}`);
        return false;
      }
    },
    [
      currentNpub,
      currentNsec,
      myProfileMetadata,
      myProfileStatus,
      publishProfile,
      publishStatus,
      setMyProfileLnAddress,
      setMyProfileMetadata,
      setMyProfileName,
      setMyProfilePicture,
      setMyProfileStatus,
      setStatus,
      t,
    ],
  );

  const saveProfileEdits = React.useCallback(async () => {
    if (unregisteredOwnLightningAddress) {
      return;
    }

    await persistProfileValues({
      lightningAddress: profileLightningAddressToPersist,
      name: profileEditName,
      navigateToProfile: true,
      picture: profileEditPicture,
      status: profileEditStatus,
    });
  }, [
    profileLightningAddressToPersist,
    profileEditName,
    profileEditPicture,
    profileEditStatus,
    persistProfileValues,
    unregisteredOwnLightningAddress,
  ]);

  const saveClaimedLightningAddress = React.useCallback(
    async (lightningAddress: string): Promise<boolean> => {
      try {
        if (!currentNpub || !currentNsec) {
          setStatus(t("profileMissingNpub"));
          return false;
        }

        const prev =
          myProfileMetadata ??
          loadCachedProfile(currentNpub)?.metadata ??
          new ProfileMetadata({});
        const next = applyLightningAddressToProfileMetadata(
          prev,
          lightningAddress,
        );

        const publishExit = await publishProfile(next.metadata);
        if (Exit.isFailure(publishExit)) throw new Error("publish failed");

        const bestName = getBestNostrName(next.metadata);
        const picture = (
          next.metadata.picture ??
          effectiveProfilePicture ??
          ""
        ).trim();
        const statusText =
          parseProfileGeneralStatus(myProfileStatus).text ?? "";

        saveCachedProfile(currentNpub, next.metadata, nowSeconds());
        setMyProfileMetadata(next.metadata);
        setMyProfileLnAddress(next.lightningAddress || null);
        setMyProfileName(bestName ?? effectiveProfileName);
        setMyProfilePicture(picture || effectiveProfilePicture);

        setProfileEditName(bestName ?? effectiveProfileName ?? "");
        setProfileEditLnAddress(next.lightningAddress);
        setProfileEditPicture(picture);
        setProfileEditStatus(statusText);
        profileEditInitialRef.current = {
          lnAddress: next.lightningAddress,
          name: bestName ?? effectiveProfileName ?? "",
          picture,
          status: statusText,
        };

        return true;
      } catch (error) {
        setStatus(`${t("errorPrefix")}: ${String(error ?? "unknown")}`);
        return false;
      }
    },
    [
      currentNpub,
      currentNsec,
      effectiveProfileName,
      effectiveProfilePicture,
      myProfileMetadata,
      myProfileStatus,
      publishProfile,
      setMyProfileLnAddress,
      setMyProfileMetadata,
      setMyProfileName,
      setMyProfilePicture,
      setStatus,
      t,
    ],
  );

  const onPickProfilePhoto = React.useCallback(async () => {
    profilePhotoInputRef.current?.click();
  }, []);

  const cycleProfileAvatarControl = React.useCallback(
    (controlId: AvatarEditorControlId) => {
      setProfileAvatarSelection((currentSelection) => {
        const nextAvatar = cycleGeneratedAvatar(currentSelection, controlId);
        setProfileSelectedPictureKind("generated");
        setProfileEditPicture(nextAvatar.pictureUrl);
        return nextAvatar.selection;
      });
    },
    [],
  );

  const onProfilePhotoSelected = React.useCallback((dataUrl: string) => {
    setProfileCustomPictureUrl(dataUrl);
    setProfileSelectedPictureKind("custom");
    setProfileEditPicture(dataUrl);
  }, []);

  const onProfilePhotoError = React.useCallback(
    (error: unknown) => {
      setStatus(`${t("errorPrefix")}: ${String(error ?? "unknown")}`);
    },
    [setStatus, t],
  );

  return {
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
    unregisteredOwnLightningAddress,
    profilePhotoInputRef,
    profileSelectedPictureKind,
    saveClaimedLightningAddress,
    saveProfileEdits,
    setIsProfileEditing,
    setProfileEditLnAddress,
    setProfileEditName,
    setProfileEditStatus,
    toggleProfileEditing,
  };
};
