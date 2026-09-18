import type { ProfileMetadata } from "@linky/linkstr";
import React from "react";
import type { Lang, Translate } from "../../../i18n";
import { persistSyncedActiveNostrIdentity } from "../../../platform/identitySecrets";
import {
  getInitialNostrIdentitySource,
  getInitialNostrIdentitySwitchedAtSec,
} from "../../../utils/storage";
import type { IdentityChangeMessageSource } from "../../lib/identityChangeMessage";
import { toSyncedNostrIdentity } from "../../lib/syncedNostrIdentity";
import {
  useIdentityRepository,
  useLinkyStore,
  useSyncedNostrIdentityRow,
} from "../useLinksync";
import { useProfileAuthDomain } from "../useProfileAuthDomain";

interface IdentityOwnersNavigation {
  reload: () => void;
}

interface UseIdentityOwnersCompositionParams {
  currentNsec: string;
  lang: Lang;
  navigation: IdentityOwnersNavigation;
  pushToast: (message: string) => void;
  setCurrentNsec: (currentNsec: string | null) => void;
  t: Translate;
}

/**
 * The app owner and the synced Nostr identity. Every shard the session
 * needs is subscribed by the store itself, so nothing here names an owner.
 */
export const useIdentityOwnersComposition = ({
  currentNsec,
  lang,
  navigation,
  pushToast,
  setCurrentNsec,
  t,
}: UseIdentityOwnersCompositionParams) => {
  const store = useLinkyStore();
  const identityRepository = useIdentityRepository();
  const appOwnerId: string = store.appOwner.id;
  const appOwnerIdRef = React.useRef<string | null>(null);

  const appendIdentityChangeNoticesRef = React.useRef<
    | ((args: {
        changedAtSec: number;
        identitySource: IdentityChangeMessageSource;
      }) => void)
    | null
  >(null);

  const myProfileMetadataRef = React.useRef<ProfileMetadata | null>(null);

  const profileAuth = useProfileAuthDomain({
    appendIdentityChangeNoticesRef,
    currentNsec,
    identityRepository,
    lang,
    myProfileMetadataRef,
    pushToast,
    t,
  });

  const syncedNostrIdentityRow = useSyncedNostrIdentityRow();
  const activeSyncedNostrIdentity = React.useMemo(
    () =>
      syncedNostrIdentityRow === null
        ? null
        : toSyncedNostrIdentity(syncedNostrIdentityRow),
    [syncedNostrIdentityRow],
  );
  const syncedNostrIdentityMatchesLocal = React.useMemo(() => {
    if (!activeSyncedNostrIdentity) return true;

    const localSource = getInitialNostrIdentitySource();
    const localSwitchedAtSec = getInitialNostrIdentitySwitchedAtSec();
    const localNsec = currentNsec.trim();
    const syncedSwitchedAtSec = activeSyncedNostrIdentity.switchedAtSec;
    const switchedAtMatches =
      localSwitchedAtSec === syncedSwitchedAtSec ||
      (!localSwitchedAtSec && !syncedSwitchedAtSec);

    return (
      localNsec === activeSyncedNostrIdentity.nsec &&
      localSource === activeSyncedNostrIdentity.source &&
      switchedAtMatches
    );
  }, [activeSyncedNostrIdentity, currentNsec]);

  React.useEffect(() => {
    if (!activeSyncedNostrIdentity) return;
    if (syncedNostrIdentityMatchesLocal) return;

    void persistSyncedActiveNostrIdentity({
      identitySource: activeSyncedNostrIdentity.source,
      nsec: activeSyncedNostrIdentity.nsec,
      switchedAtSec: activeSyncedNostrIdentity.switchedAtSec,
    }).then(() => {
      setCurrentNsec(activeSyncedNostrIdentity.nsec);
      navigation.reload();
    });
  }, [
    activeSyncedNostrIdentity,
    navigation,
    syncedNostrIdentityMatchesLocal,
    setCurrentNsec,
  ]);

  return {
    ...profileAuth,
    activeSyncedNostrIdentity,
    appOwnerId,
    appOwnerIdRef,
    appendIdentityChangeNoticesRef,
    currentNsec,
    myProfileMetadataRef,
    syncedNostrIdentityMatchesLocal,
    syncedNostrIdentityRow,
  };
};
