import { useAtomSet, useAtomValue } from "@linky-fit/linkstr-react";
import React from "react";
import { useLatest } from "../../../hooks/useLatest";
import type { Lang, Translate } from "../../../i18n";
import { persistSyncedActiveNostrIdentity } from "../../../platform/identitySecrets";
import {
  getInitialNostrIdentitySource,
  getInitialNostrIdentitySwitchedAtSec,
} from "../../../utils/storage";
import { platformAtom } from "../../state/platform";
import { identityCommandsAtom } from "../../state/session/identity";
import { sessionAtom } from "../../state/session/session";
import { toSyncedNostrIdentity } from "../../lib/syncedNostrIdentity";
import {
  useIdentityRepository,
  useAppOwnerId,
  useInboxCursorsRepository,
  useSyncedNostrIdentityRow,
} from "../useLinksync";
import { useProvideOwnerCommands } from "../shell/ownerCommands";
import { useProfileAuthDomain } from "../useProfileAuthDomain";

interface UseIdentityOwnersCompositionParams {
  currentNsec: string;
  lang: Lang;
  pushToast: (message: string) => void;
  t: Translate;
}

/**
 * The app owner and the synced Nostr identity. Every shard the session
 * needs is subscribed by the store itself, so nothing here names an owner.
 */
export const useIdentityOwnersComposition = ({
  currentNsec,
  lang,
  pushToast,
  t,
}: UseIdentityOwnersCompositionParams) => {
  const { lifecycle } = useAtomValue(platformAtom);
  const setSession = useAtomSet(sessionAtom);
  const identityRepository = useIdentityRepository();
  const inboxCursors = useInboxCursorsRepository();
  const appOwnerId: string = useAppOwnerId();
  const appOwnerIdRef = useLatest<string | null>(appOwnerId);

  const profileAuth = useProfileAuthDomain({
    currentNsec,
    identityRepository,
    inboxCursors,
    lang,
    pushToast,
    t,
  });

  useProvideOwnerCommands(identityCommandsAtom, {
    answerPendingIdentitySwitch: profileAuth.answerPendingIdentitySwitch,
    requestLogout: profileAuth.requestLogout,
    requestPasteNostrKeys: profileAuth.requestPasteNostrKeys,
    switchToDefaultIdentity: profileAuth.switchToDefaultIdentity,
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
      setSession((session) =>
        session._tag === "SignedIn"
          ? {
              ...session,
              secrets: {
                ...session.secrets,
                nsec: activeSyncedNostrIdentity.nsec,
              },
            }
          : session,
      );
      lifecycle.reload();
    });
  }, [
    activeSyncedNostrIdentity,
    lifecycle,
    setSession,
    syncedNostrIdentityMatchesLocal,
  ]);

  return {
    ...profileAuth,
    appOwnerId,
    appOwnerIdRef,
    currentNsec,
    syncedNostrIdentityMatchesLocal,
  };
};
