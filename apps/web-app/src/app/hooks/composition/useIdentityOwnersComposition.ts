import * as Evolu from "@evolu/common";
import { useOwner, useQuery } from "@evolu/react";
import type { ProfileMetadata } from "@linky/linkstr";
import React from "react";
import type { evolu, useEvolu } from "../../../evolu";
import { useEvoluSyncOwner } from "../../../evolu";
import type { Lang } from "../../../i18n";
import { persistSyncedActiveNostrIdentity } from "../../../platform/identitySecrets";
import {
  getInitialNostrIdentitySource,
  getInitialNostrIdentitySwitchedAtSec,
} from "../../../utils/storage";
import type { IdentityChangeMessageSource } from "../../lib/identityChangeMessage";
import {
  ACTIVE_NOSTR_IDENTITY_ROW_ID,
  resolveSyncedNostrIdentity,
} from "../../lib/nostrIdentitySync";
import { useEvoluContactsOwnerRotation } from "../useEvoluContactsOwnerRotation";
import { useProfileAuthDomain } from "../useProfileAuthDomain";
import type { Translate } from "../../../i18n";

interface IdentityOwnersNavigation {
  reload: () => void;
}

interface UseIdentityOwnersCompositionParams {
  currentNsec: string;
  evolu: typeof evolu;
  lang: Lang;
  navigation: IdentityOwnersNavigation;
  pushToast: (message: string) => void;
  setCurrentNsec: (currentNsec: string | null) => void;
  t: Translate;
  upsert: ReturnType<typeof useEvolu>["upsert"];
}

export const useIdentityOwnersComposition = ({
  currentNsec,
  evolu,
  lang,
  navigation,
  pushToast,
  setCurrentNsec,
  t,
  upsert,
}: UseIdentityOwnersCompositionParams) => {
  const appOwnerIdRef = React.useRef<Evolu.OwnerId | null>(null);
  const cashuOwnerIdRef = React.useRef<Evolu.OwnerId | null>(null);
  const messagesOwnerIdRef = React.useRef<Evolu.OwnerId | null>(null);
  const transactionsOwnerIdRef = React.useRef<Evolu.OwnerId | null>(null);

  const syncOwner = useEvoluSyncOwner(Boolean(currentNsec));

  useOwner(syncOwner);

  const appOwnerId = syncOwner?.id ?? null;

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
    lang,
    myProfileMetadataRef,
    pushToast,
    t,
    upsert,
  });

  const ownerRotation = useEvoluContactsOwnerRotation({
    appOwnerId,
    isSeedLogin: profileAuth.isSeedLogin,
    pushToast,
    slip39Seed: profileAuth.slip39Seed,
    t,
    upsert,
  });

  useOwner(ownerRotation.contactsSyncOwner);
  useOwner(ownerRotation.cashuSyncOwner);
  useOwner(ownerRotation.messagesSyncOwner);
  useOwner(ownerRotation.transactionsSyncOwner);
  useOwner(ownerRotation.metaSyncOwner);
  useOwner(ownerRotation.identitySyncOwner);

  const historicalOwnerSetsReady = profileAuth.isSeedLogin
    ? ownerRotation.cashuVisibleOwnerIds.length ===
        ownerRotation.cashuOwnerIndex + 1 &&
      ownerRotation.contactsVisibleOwnerIds.length ===
        ownerRotation.contactsOwnerIndex + 1 &&
      ownerRotation.messagesVisibleOwnerIds.length ===
        ownerRotation.messagesOwnerIndex + 1 &&
      ownerRotation.transactionsVisibleOwnerIds.length ===
        ownerRotation.transactionsOwnerIndex + 1
    : true;
  React.useEffect(() => {
    if (!profileAuth.isSeedLogin || !historicalOwnerSetsReady) return;

    // Evolu does not expose an initial-sync-complete signal. Keep historical
    // lanes subscribed for the whole authenticated session instead of
    // guessing completion from a quiet timer and disconnecting them while
    // their stored messages may still be arriving.
    const stopUsingOwners = ownerRotation.historicalBootstrapSyncOwners.map(
      (owner) => evolu.useOwner(owner),
    );
    return () => {
      for (const stopUsingOwner of stopUsingOwners) stopUsingOwner();
    };
  }, [
    evolu,
    historicalOwnerSetsReady,
    ownerRotation.historicalBootstrapSyncOwners,
    profileAuth.isSeedLogin,
  ]);

  React.useEffect(() => {
    cashuOwnerIdRef.current = ownerRotation.cashuOwnerId;
  }, [ownerRotation.cashuOwnerId]);

  React.useEffect(() => {
    messagesOwnerIdRef.current = ownerRotation.messagesOwnerId;
  }, [ownerRotation.messagesOwnerId]);

  React.useEffect(() => {
    transactionsOwnerIdRef.current = ownerRotation.transactionsOwnerId;
  }, [ownerRotation.transactionsOwnerId]);

  const nostrIdentityQuery = React.useMemo(
    () =>
      evolu.createQuery((db) =>
        db
          .selectFrom("nostrIdentity")
          .selectAll()
          .where("isDeleted", "is not", Evolu.sqliteTrue)
          .orderBy("createdAt", "desc"),
      ),
    [evolu],
  );
  const nostrIdentityRows = useQuery(nostrIdentityQuery);

  const activeIdentityOwnerId = (ownerRotation.identityOwnerId ?? "").trim();
  const legacyNostrIdentityOwnerIds = React.useMemo(
    () =>
      new Set(
        [
          ...ownerRotation.messagesVisibleOwnerIds,
          ownerRotation.legacyIdentitiesOwnerId,
          ownerRotation.legacyMessagesIdentityOwnerId,
          ownerRotation.metaOwnerId,
        ]
          .map((ownerId) => (ownerId ?? "").trim())
          .filter(Boolean),
      ),
    [
      ownerRotation.legacyIdentitiesOwnerId,
      ownerRotation.legacyMessagesIdentityOwnerId,
      ownerRotation.messagesVisibleOwnerIds,
      ownerRotation.metaOwnerId,
    ],
  );
  const syncedNostrIdentityResolution = React.useMemo(
    () =>
      resolveSyncedNostrIdentity(
        nostrIdentityRows,
        activeIdentityOwnerId,
        legacyNostrIdentityOwnerIds,
      ),
    [activeIdentityOwnerId, legacyNostrIdentityOwnerIds, nostrIdentityRows],
  );
  const activeSyncedNostrIdentity = syncedNostrIdentityResolution.identity;
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
    if (!syncedNostrIdentityResolution.shouldMigrateLegacyIdentity) return;
    if (!activeSyncedNostrIdentity || !ownerRotation.identityOwnerId) return;

    upsert(
      "nostrIdentity",
      {
        id: ACTIVE_NOSTR_IDENTITY_ROW_ID,
        nsec: activeSyncedNostrIdentity.nsec,
        source: activeSyncedNostrIdentity.source,
        ...(activeSyncedNostrIdentity.npub
          ? { npub: activeSyncedNostrIdentity.npub }
          : {}),
        ...(activeSyncedNostrIdentity.switchedAtSec
          ? { switchedAtSec: activeSyncedNostrIdentity.switchedAtSec }
          : {}),
      },
      { ownerId: ownerRotation.identityOwnerId },
    );
  }, [
    activeSyncedNostrIdentity,
    ownerRotation.identityOwnerId,
    syncedNostrIdentityResolution.shouldMigrateLegacyIdentity,
    upsert,
  ]);

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
    ...ownerRotation,
    activeSyncedNostrIdentity,
    appOwnerId,
    appOwnerIdRef,
    appendIdentityChangeNoticesRef,
    cashuOwnerIdRef,
    currentNsec,
    historicalOwnerSetsReady,
    messagesOwnerIdRef,
    myProfileMetadataRef,
    nostrIdentityRows,
    syncedNostrIdentityMatchesLocal,
    syncedNostrIdentityResolution,
    syncOwner,
    transactionsOwnerIdRef,
  };
};
