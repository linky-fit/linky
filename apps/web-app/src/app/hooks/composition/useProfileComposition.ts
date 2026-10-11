import type { ProfileMetadata } from "@linky-fit/linkstr";
import { useAtomSet, useAtomValue } from "@linky-fit/linkstr-react";
import React from "react";
import type { useRouting } from "../../../hooks/useRouting";
import { getBestNostrName } from "../../../utils/formatting";
import { normalizeNpubIdentifier } from "../../../utils/nostrNpub";
import { useNpubNip05Cleanup } from "../profile/useNpubNip05Cleanup";
import {
  useProfileEditing,
  useUpdateMyProfile,
} from "../profile/useProfileEditor";
import {
  myProfileMetadataAtom,
  ownedLightningAddressesAtom,
} from "../../state/contacts/profiles";

interface UseProfileCompositionParams {
  currentNpub: string | null;
  /** Watch-fed per-npub maps from the messaging composition. */
  nostrMetadataByNpub: Record<string, ProfileMetadata | null>;
  nostrPictureByNpub: Record<string, string | null>;
  nostrStatusByNpub: Record<string, string | null>;
  nostrBootstrapReady: boolean;
  route: ReturnType<typeof useRouting>;
}

/**
 * Keeps the own profile atoms current from the profile watch and opens the
 * edit form on the profile-edit route; screens read the atoms themselves.
 */
export const useProfileComposition = ({
  currentNpub,
  nostrMetadataByNpub,
  nostrPictureByNpub,
  nostrStatusByNpub,
  nostrBootstrapReady,
  route,
}: UseProfileCompositionParams) => {
  const updateMyProfile = useUpdateMyProfile();
  const setMyProfileMetadata = useAtomSet(myProfileMetadataAtom);
  const setOwned = useAtomSet(ownedLightningAddressesAtom);
  const ownedProfileLightningAddresses = useAtomValue(
    ownedLightningAddressesAtom,
    (owned) => owned.addresses,
  );
  const { isProfileEditing, setIsProfileEditing, toggleProfileEditing } =
    useProfileEditing();

  const npubCashInfoInFlightRef = React.useRef(false);
  const npubCashInfoLoadedForNpubRef = React.useRef<string | null>(null);
  const npubCashInfoLoadedAtMsRef = React.useRef<number>(0);

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
    const ln =
      (watchedMetadata.lud16 ?? "").trim() ||
      (watchedMetadata.lud06 ?? "").trim();
    updateMyProfile({
      ...(bestName ? { name: bestName } : {}),
      lnAddress: ln || null,
    });
  }, [setMyProfileMetadata, updateMyProfile, watchedMetadata]);

  React.useEffect(() => {
    if (watchedPicture === undefined) return;
    updateMyProfile({ picture: watchedPicture });
  }, [updateMyProfile, watchedPicture]);

  React.useEffect(() => {
    if (watchedStatus === undefined) return;
    updateMyProfile({ status: watchedStatus });
  }, [updateMyProfile, watchedStatus]);

  useNpubNip05Cleanup({
    currentNpub,
    enabled: nostrBootstrapReady,
    setMyProfileMetadata,
  });

  React.useEffect(() => {
    if (route.kind !== "profileEdit") {
      return;
    }

    if (!isProfileEditing) {
      toggleProfileEditing();
    }
  }, [isProfileEditing, route.kind, toggleProfileEditing]);

  const setOwnedProfileLightningAddresses = React.useCallback(
    (addresses: string[]) => setOwned((owned) => ({ ...owned, addresses })),
    [setOwned],
  );
  const setOwnedProfileLightningAddressesLoading = React.useCallback(
    (loading: boolean) => setOwned((owned) => ({ ...owned, loading })),
    [setOwned],
  );

  return {
    isProfileEditing,
    npubCashInfoInFlightRef,
    npubCashInfoLoadedAtMsRef,
    npubCashInfoLoadedForNpubRef,
    ownedProfileLightningAddresses,
    setIsProfileEditing,
    setOwnedProfileLightningAddresses,
    setOwnedProfileLightningAddressesLoading,
  };
};
