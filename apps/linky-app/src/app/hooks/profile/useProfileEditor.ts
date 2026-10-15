import { ProfileMetadata, StatusDraft } from "@linky-fit/linkstr";
import {
  RegistryContext,
  useAtomSet,
  useAtomValue,
  useLinkstrCommands,
} from "@linky-fit/linkstr-react";
import { Exit, Struct } from "effect";
import React from "react";
import { buildLoreleiAvatarUrl } from "../../../derivedProfile";
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
import { getProfileNip05 } from "../../../utils/nostrNip05";
import {
  getOwnLightningAddressInputCandidate,
  type OwnLightningAddressInputCandidate,
} from "../../../utils/npubCashUsernameClaim";
import { isHttpUrl } from "../../../utils/validation";
import { applyLightningAddressToProfileMetadata } from "../../lib/profileMetadata";
import { prepareProfilePicture } from "../../lib/profilePicture";
import {
  effectiveProfileAtom,
  myProfileAtom,
  myProfileMetadataAtom,
  ownedLightningAddressesAtom,
  profileDraftAtom,
  type MyProfile,
  type ProfileDraft,
} from "../../state/contacts/profiles";
import { currentNpubAtom, currentNsecAtom } from "../../state/session/session";
import type { FilePickerHandle } from "../../../utils/pickFile";
import { nowSeconds } from "../../../utils/time";
import { useSetStatus, useTranslation } from "../shell";

interface PersistProfileValuesArgs {
  lightningAddress: string;
  name: string;
  navigateToProfile: boolean;
  picture: string;
  status: string;
}

const useUpdateDraft = () => {
  const setDraft = useAtomSet(profileDraftAtom);
  return React.useCallback(
    (patch: Partial<ProfileDraft>) =>
      setDraft((draft) => ({ ...draft, ...patch })),
    [setDraft],
  );
};

/** Updates the own profile's fields as just published or watched. */
export const useUpdateMyProfile = () => {
  const setMyProfile = useAtomSet(myProfileAtom);
  return React.useCallback(
    (patch: Partial<MyProfile>) =>
      setMyProfile((profile) => ({ ...profile, ...patch })),
    [setMyProfile],
  );
};

/** Whether the profile form is open, and opening or closing it. */
export const useProfileEditing = () => {
  const isProfileEditing = useAtomValue(
    profileDraftAtom,
    (draft) => draft.editing,
  );
  const updateDraft = useUpdateDraft();
  const currentNpub = useAtomValue(currentNpubAtom);
  const myProfileMetadata = useAtomValue(myProfileMetadataAtom);
  const myProfileStatus = useAtomValue(myProfileAtom, (my) => my.status);
  const {
    effectiveMyLightningAddress,
    effectiveProfileName,
    effectiveProfilePicture,
  } = useAtomValue(effectiveProfileAtom);

  const setIsProfileEditing = React.useCallback(
    (editing: boolean) => updateDraft({ editing }),
    [updateDraft],
  );

  const toggleProfileEditing = React.useCallback(() => {
    if (isProfileEditing) {
      updateDraft({ editing: false, initial: null });
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

    const generatedPicture = buildLoreleiAvatarUrl(currentNpub ?? initialName);
    const initialPicture = metaPic || generatedPicture;
    const customPicture =
      metaPic && metaPic !== generatedPicture ? metaPic : "";
    const initialStatus = parseProfileGeneralStatus(myProfileStatus).text ?? "";

    const initial = {
      name: initialName,
      lnAddress: initialLn,
      picture: initialPicture,
      status: initialStatus,
    };
    updateDraft({
      ...initial,
      customPictureUrl: customPicture,
      editing: true,
      initial,
      pictureKind: customPicture ? "custom" : "generated",
    });
  }, [
    effectiveMyLightningAddress,
    effectiveProfileName,
    effectiveProfilePicture,
    isProfileEditing,
    myProfileMetadata,
    myProfileStatus,
    currentNpub,
    updateDraft,
  ]);

  return { isProfileEditing, setIsProfileEditing, toggleProfileEditing };
};

/** The profile edit form: its fields, the photo picker, and publishing the result. */
export const useProfileEditor = () => {
  const { t } = useTranslation();
  const setStatus = useSetStatus();
  const registry = React.useContext(RegistryContext);
  const draft = useAtomValue(profileDraftAtom);
  const updateDraft = useUpdateDraft();
  const updateMyProfile = useUpdateMyProfile();
  const setMyProfileMetadata = useAtomSet(myProfileMetadataAtom);
  const currentNpub = useAtomValue(currentNpubAtom);
  const currentNsec = useAtomValue(currentNsecAtom);
  const myProfileMetadata = useAtomValue(myProfileMetadataAtom);
  const myProfileStatus = useAtomValue(myProfileAtom, (my) => my.status);
  const {
    defaultLightningAddress,
    effectiveMyLightningAddress,
    effectiveProfileName,
    effectiveProfilePicture,
  } = useAtomValue(effectiveProfileAtom);
  const owned = useAtomValue(ownedLightningAddressesAtom);
  const { isProfileEditing, setIsProfileEditing, toggleProfileEditing } =
    useProfileEditing();

  const profilePhotoInputRef = React.useRef<FilePickerHandle | null>(null);

  const profileEditsDirty = React.useMemo(() => {
    if (!draft.editing) return false;
    if (!draft.initial) return false;

    const initial = draft.initial;
    return (
      draft.name.trim() !== initial.name.trim() ||
      draft.lnAddress.trim() !== initial.lnAddress.trim() ||
      draft.picture.trim() !== initial.picture.trim() ||
      draft.status.trim() !== initial.status.trim()
    );
  }, [draft]);

  const profileEditsSavable =
    profileEditsDirty && Boolean(currentNpub && currentNsec);

  const ownLightningAddressInputCandidate = React.useMemo(() => {
    if (owned.loading) return null;
    return getOwnLightningAddressInputCandidate(draft.lnAddress);
  }, [owned.loading, draft.lnAddress]);

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

      for (const lightningAddress of owned.addresses) {
        const normalizedOwned = lightningAddress.trim().toLowerCase();
        if (normalizedOwned && candidate.lightningAddress === normalizedOwned) {
          return true;
        }
      }

      return false;
    },
    [defaultLightningAddress, owned.addresses],
  );

  const unregisteredOwnLightningAddress = React.useMemo(() => {
    if (!ownLightningAddressInputCandidate) return null;
    if (
      ownLightningAddressInputCandidate.lightningAddress ===
      effectiveMyLightningAddress?.trim().toLowerCase()
    ) {
      return null;
    }
    if (
      ownLightningAddressMatchesCurrentIdentity(
        ownLightningAddressInputCandidate,
      )
    ) {
      return null;
    }
    return ownLightningAddressInputCandidate;
  }, [
    effectiveMyLightningAddress,
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

    return draft.lnAddress;
  }, [
    ownLightningAddressInputCandidate,
    ownLightningAddressMatchesCurrentIdentity,
    draft.lnAddress,
  ]);

  const { publishProfile, publishStatus } = useLinkstrCommands();

  const persistProfileValues = React.useCallback(
    async ({
      lightningAddress,
      name,
      navigateToProfile,
      picture,
      status,
    }: PersistProfileValuesArgs): Promise<boolean> => {
      // Read at call time, so a second tap during the first one's publish is turned away.
      if (registry.get(profileDraftAtom).saving) return false;
      updateDraft({ saving: true });
      try {
        if (!currentNpub || !currentNsec) {
          setStatus(t("profileMissingNpub"));
          return false;
        }

        const trimmedName = name.trim();
        const trimmedLightningAddress = lightningAddress.trim();
        const trimmedPicture = await prepareProfilePicture(
          picture,
          currentNsec,
        );
        const trimmedStatus = status.trim();
        const nextStatus = buildProfileGeneralStatus({
          currencies: parseProfileGeneralStatus(myProfileStatus).currencies,
          text: status,
        });

        // The own pubkey is watched, so cache/state carry the newest profile.
        const prev =
          myProfileMetadata ?? loadCachedProfile(currentNpub)?.metadata ?? null;
        const nip05 = getProfileNip05(trimmedLightningAddress, prev?.nip05);

        const nextMetadata = new ProfileMetadata({
          ...(prev
            ? Struct.omit(prev, [
                "name",
                "displayName",
                "lud16",
                "lud06",
                "nip05",
                "picture",
              ])
            : {}),
          ...(trimmedName
            ? { name: trimmedName, displayName: trimmedName }
            : {}),
          ...(trimmedLightningAddress
            ? {
                lud16: trimmedLightningAddress,
                ...(prev?.lud06 ? { lud06: prev.lud06 } : {}),
              }
            : {}),
          ...(nip05 ? { nip05 } : {}),
          ...(trimmedPicture ? { picture: trimmedPicture } : {}),
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
        updateMyProfile({
          name: trimmedName || null,
          lnAddress: trimmedLightningAddress || null,
          picture: trimmedPicture || null,
          status: nextStatus,
        });
        const saved = {
          lnAddress: trimmedLightningAddress,
          name: trimmedName,
          picture: trimmedPicture,
          status: trimmedStatus,
        };
        updateDraft({ ...saved, initial: saved });

        if (!trimmedPicture || !isHttpUrl(trimmedPicture)) {
          void deleteCachedProfileAvatar(currentNpub);
        } else {
          void cacheProfileAvatarFromUrl(currentNpub, trimmedPicture);
        }

        if (navigateToProfile) {
          updateDraft({ editing: false, initial: null });
          navigateTo({ route: "profile" });
        }

        return true;
      } catch (error) {
        setStatus(`${t("errorPrefix")}: ${String(error ?? "unknown")}`);
        return false;
      } finally {
        updateDraft({ saving: false });
      }
    },
    [
      currentNpub,
      currentNsec,
      myProfileMetadata,
      myProfileStatus,
      publishProfile,
      publishStatus,
      registry,
      setMyProfileMetadata,
      setStatus,
      t,
      updateDraft,
      updateMyProfile,
    ],
  );

  const saveProfileEdits = React.useCallback(async () => {
    if (unregisteredOwnLightningAddress) {
      return;
    }

    await persistProfileValues({
      lightningAddress: profileLightningAddressToPersist,
      name: draft.name,
      navigateToProfile: true,
      picture: draft.picture,
      status: draft.status,
    });
  }, [
    profileLightningAddressToPersist,
    draft.name,
    draft.picture,
    draft.status,
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
        updateMyProfile({
          lnAddress: next.lightningAddress || null,
          name: bestName ?? effectiveProfileName,
          picture: picture || effectiveProfilePicture,
        });

        const saved = {
          lnAddress: next.lightningAddress,
          name: bestName ?? effectiveProfileName ?? "",
          picture,
          status: statusText,
        };
        updateDraft({ ...saved, initial: saved });

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
      setMyProfileMetadata,
      setStatus,
      t,
      updateDraft,
      updateMyProfile,
    ],
  );

  const onPickProfilePhoto = React.useCallback(async () => {
    profilePhotoInputRef.current?.pick();
  }, []);

  const shuffleProfileAvatar = React.useCallback(() => {
    updateDraft({
      pictureKind: "generated",
      picture: buildLoreleiAvatarUrl(crypto.randomUUID()),
    });
  }, [updateDraft]);

  const onProfilePhotoSelected = React.useCallback(
    (dataUrl: string) => {
      updateDraft({
        customPictureUrl: dataUrl,
        pictureKind: "custom",
        picture: dataUrl,
      });
    },
    [updateDraft],
  );

  const onProfilePhotoError = React.useCallback(
    (error: unknown) => {
      setStatus(`${t("errorPrefix")}: ${String(error ?? "unknown")}`);
    },
    [setStatus, t],
  );

  const setProfileEditName = React.useCallback(
    (name: string) => updateDraft({ name }),
    [updateDraft],
  );
  const setProfileEditLnAddress = React.useCallback(
    (lnAddress: string) => updateDraft({ lnAddress }),
    [updateDraft],
  );
  const setProfileEditStatus = React.useCallback(
    (status: string) => updateDraft({ status }),
    [updateDraft],
  );

  return {
    shuffleProfileAvatar,
    isProfileEditing,
    onPickProfilePhoto,
    onProfilePhotoError,
    onProfilePhotoSelected,
    profileCustomPictureUrl: draft.customPictureUrl,
    profileEditLnAddress: draft.lnAddress,
    profileEditName: draft.name,
    profileEditPicture: draft.picture,
    profileEditStatus: draft.status,
    profileEditsSavable,
    profileIsSaving: draft.saving,
    unregisteredOwnLightningAddress,
    profilePhotoInputRef,
    profileSelectedPictureKind: draft.pictureKind,
    saveClaimedLightningAddress,
    saveProfileEdits,
    setIsProfileEditing,
    setProfileEditLnAddress,
    setProfileEditName,
    setProfileEditStatus,
    toggleProfileEditing,
  };
};
