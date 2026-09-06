import { writeContact } from "../lib/writeContact";
import * as Evolu from "@evolu/common";
import type {
  ProfileFetchEntry,
  ProfileFetchResult,
  ProfileMetadata,
  ProfileUpdated,
  ProfileWatchEvent,
  StatusUpdated,
} from "@linky/linkstr";
import { decodeNpub, encodeNpub, Pubkey } from "@linky/linkstr";
import {
  profileWatchAtom,
  profileWatchHandlerAtom,
  useAtomMount,
  useAtomSet,
  watchedProfilesAtom,
} from "@linky/linkstr-react";
import { Exit } from "effect";
import React from "react";
import {
  cacheProfileAvatarFromUrl,
  deleteCachedProfileAvatar,
  getProfilePictureUrl,
  loadCachedProfile,
  loadCachedProfileAvatarObjectUrl,
  loadCachedStatus,
  saveCachedProfile,
  saveCachedStatus,
} from "../../profileCache";
import { getBestNostrName } from "../../utils/formatting";
import { normalizeNpubIdentifier } from "../../utils/nostrNpub";
import { resolveContactRowOwnerLane } from "../lib/contactOwnerLane";
import { getContactPublicProfile } from "../lib/contactProfile";
import type { ContactRowLike } from "../types/appTypes";

const decodeNpubToPubkey = (npub: string): Pubkey | null => {
  return decodeNpub(npub);
};

const encodePubkeyToNpub = (pubkey: Pubkey): string => encodeNpub(pubkey);

const cacheFetchedProfile = (
  npub: string,
  profile: ProfileUpdated | null,
): ProfileMetadata | null => {
  if (!profile) return null;
  const cached = loadCachedProfile(npub);
  if (cached && profile.updatedAt <= cached.updatedAt) return cached.metadata;
  saveCachedProfile(npub, profile.metadata, profile.updatedAt);
  return profile.metadata;
};

/**
 * One-shot profile fetch for pubkeys that are not (yet) watched: contact
 * search and unknown-sender previews. Feeds the same v2 cache as the watch.
 */
export const fetchAndCacheProfile = async (
  fetchProfile: (
    pubkey: Pubkey,
  ) => Promise<Exit.Exit<ProfileFetchResult, unknown>>,
  npub: string,
): Promise<ProfileMetadata | null> => {
  const pubkey = decodeNpubToPubkey(npub);
  if (!pubkey) return null;
  const exit = await fetchProfile(pubkey);
  if (Exit.isFailure(exit)) return null;
  return cacheFetchedProfile(npub, exit.value.profile);
};

/**
 * Batched variant for many unwatched npubs at once: one chunked multi-author
 * relay query through `Profiles.fetchProfiles`. Undecodable npubs and failed
 * fetches map to null, mirroring the single-npub behavior.
 */
export const fetchAndCacheProfiles = async (
  fetchProfiles: (
    pubkeys: ReadonlyArray<Pubkey>,
  ) => Promise<Exit.Exit<ReadonlyArray<ProfileFetchEntry>, unknown>>,
  npubs: ReadonlyArray<string>,
): Promise<Map<string, ProfileMetadata | null>> => {
  const metadataByNpub = new Map<string, ProfileMetadata | null>();
  const npubByPubkey = new Map<Pubkey, string>();
  for (const npub of npubs) {
    const pubkey = decodeNpubToPubkey(npub);
    if (pubkey) npubByPubkey.set(pubkey, npub);
    else metadataByNpub.set(npub, null);
  }
  if (npubByPubkey.size === 0) return metadataByNpub;

  const exit = await fetchProfiles([...npubByPubkey.keys()]);
  const profileByPubkey = new Map<Pubkey, ProfileUpdated | null>();
  if (Exit.isSuccess(exit)) {
    for (const entry of exit.value) {
      profileByPubkey.set(entry.pubkey, entry.profile);
    }
  }
  for (const [pubkey, npub] of npubByPubkey) {
    metadataByNpub.set(
      npub,
      cacheFetchedProfile(npub, profileByPubkey.get(pubkey) ?? null),
    );
  }
  return metadataByNpub;
};

type SetByNpub<T> = React.Dispatch<
  React.SetStateAction<Record<string, T | null>>
>;

type ContactRowUpdate = (
  table: "contact",
  props: {
    id: string;
    lnAddress?: typeof Evolu.NonEmptyString1000.Type | null;
    name?: typeof Evolu.NonEmptyString1000.Type | null;
  },
  options?: { readonly ownerId?: Evolu.OwnerId },
) => Evolu.Result<unknown, unknown>;

interface ProfileSyncContext {
  contacts: readonly (ContactRowLike & { id: string })[];
  contactsOwnerId: Evolu.OwnerId | null;
  contactsVisibleOwnerIds: readonly Evolu.OwnerId[];
  routeKind: string;
  setNostrMetadataByNpub: SetByNpub<ProfileMetadata>;
  setNostrPictureByNpub: SetByNpub<string>;
  setNostrStatusByNpub: SetByNpub<string>;
  update: ContactRowUpdate;
}

const syncContactsFromProfile = (
  npub: string,
  metadata: ProfileMetadata,
  previousMetadata: ProfileMetadata | null | undefined,
  ctx: ProfileSyncContext,
): void => {
  // Never rewrite rows under an open contact form.
  if (ctx.routeKind === "contactEdit" || ctx.routeKind === "contactNew") {
    return;
  }

  const bestName = getBestNostrName(metadata) ?? "";
  const profileLn = getContactPublicProfile(npub, metadata).lnAddress;
  const previousBestName = previousMetadata
    ? (getBestNostrName(previousMetadata) ?? "")
    : "";
  const previousProfileLn = getContactPublicProfile(
    npub,
    previousMetadata,
  ).lnAddress.toLowerCase();

  for (const contact of ctx.contacts) {
    if (normalizeNpubIdentifier(contact.npub ?? "") !== npub) continue;

    const patch: Partial<{
      lnAddress: typeof Evolu.NonEmptyString1000.Type | null;
      name: typeof Evolu.NonEmptyString1000.Type | null;
    }> = {};

    // Non-overridden fields follow the profile. A value the profile never
    // provided (legacy manual entry, search fallback) is never cleared:
    // clearing requires that the row still holds what the previous profile
    // said, i.e. the profile itself dropped the field.
    const currentName = (contact.name ?? "").trim();
    if (!contact.nameSetByUser) {
      if (bestName && bestName !== currentName) {
        const parsedName = Evolu.NonEmptyString1000.fromUnknown(bestName);
        if (parsedName.ok) patch.name = parsedName.value;
      } else if (!bestName && currentName && currentName === previousBestName) {
        patch.name = null;
      }
    }

    const parsedLnAddressSetByUser = Evolu.SqliteBoolean.fromUnknown(
      contact.lnAddressSetByUser,
    );
    const hasLocalLnAddress =
      parsedLnAddressSetByUser.ok &&
      parsedLnAddressSetByUser.value === Evolu.sqliteTrue;
    const currentLn = (contact.lnAddress ?? "").trim().toLowerCase();
    if (!hasLocalLnAddress) {
      if (profileLn && profileLn.toLowerCase() !== currentLn) {
        const parsedLn = Evolu.NonEmptyString1000.fromUnknown(profileLn);
        if (parsedLn.ok) patch.lnAddress = parsedLn.value;
      } else if (!profileLn && currentLn && currentLn === previousProfileLn) {
        patch.lnAddress = null;
      }
    }

    if (Object.keys(patch).length === 0) continue;
    const ownerId =
      resolveContactRowOwnerLane(contact, ctx.contactsVisibleOwnerIds) ??
      ctx.contactsOwnerId;
    const payload = { id: contact.id, ...patch };
    writeContact(ctx.update, payload, ownerId);
  }
};

const applyProfileUpdated = (
  npub: string,
  fact: ProfileUpdated,
  ctx: ProfileSyncContext,
): void => {
  const cached = loadCachedProfile(npub);
  if (cached && fact.updatedAt <= cached.updatedAt) return;
  saveCachedProfile(npub, fact.metadata, fact.updatedAt);

  ctx.setNostrMetadataByNpub((prev) => ({ ...prev, [npub]: fact.metadata }));

  const previousUrl = getProfilePictureUrl(cached?.metadata);
  const url = getProfilePictureUrl(fact.metadata);
  if (url === null) {
    void deleteCachedProfileAvatar(npub);
    ctx.setNostrPictureByNpub((prev) => ({ ...prev, [npub]: null }));
  } else if (url !== previousUrl) {
    ctx.setNostrPictureByNpub((prev) => ({ ...prev, [npub]: url }));
    void cacheProfileAvatarFromUrl(npub, url).then((blobUrl) => {
      if (blobUrl) {
        ctx.setNostrPictureByNpub((prev) => ({ ...prev, [npub]: blobUrl }));
      } else {
        void deleteCachedProfileAvatar(npub);
      }
    });
  }

  syncContactsFromProfile(npub, fact.metadata, cached?.metadata, ctx);
};

const applyStatusUpdated = (
  npub: string,
  fact: StatusUpdated,
  ctx: ProfileSyncContext,
): void => {
  const cached = loadCachedStatus(npub);
  if (cached && fact.updatedAt <= cached.updatedAt) return;
  saveCachedStatus(npub, fact.content, fact.updatedAt);
  ctx.setNostrStatusByNpub((prev) => ({
    ...prev,
    [npub]: fact.content || null,
  }));
};

export const applyProfileWatchEvent = (
  event: ProfileWatchEvent,
  ctx: ProfileSyncContext,
): void => {
  const npub = encodePubkeyToNpub(event.pubkey);
  if (!npub) return;
  if (event._tag === "ProfileUpdated") applyProfileUpdated(npub, event, ctx);
  else applyStatusUpdated(npub, event, ctx);
};

interface UseLinkstrProfileSyncParams extends ProfileSyncContext {
  currentNpub: string | null;
  enabled: boolean;
}

/**
 * Watches kind 0/30315 for every contact plus the own pubkey through the
 * linkstr `ProfileWatch`, feeding the v2 caches, the per-npub UI maps, and
 * the contact-row name/lnAddress policy. Seeds the maps from cache so a
 * fresh launch renders instantly.
 */
export const useLinkstrProfileSync = ({
  currentNpub,
  enabled,
  ...context
}: UseLinkstrProfileSyncParams) => {
  const setWatchedProfiles = useAtomSet(watchedProfilesAtom);
  const setProfileWatchHandler = useAtomSet(profileWatchHandlerAtom);
  useAtomMount(profileWatchAtom);

  const { contacts } = context;
  const {
    setNostrMetadataByNpub,
    setNostrPictureByNpub,
    setNostrStatusByNpub,
  } = context;

  const watchedNpubsKey = React.useMemo(() => {
    const npubs = new Set<string>();
    for (const contact of contacts) {
      const npub = normalizeNpubIdentifier(contact.npub ?? "");
      if (npub) npubs.add(npub);
    }
    const ownNpub = normalizeNpubIdentifier(currentNpub ?? "");
    if (ownNpub) npubs.add(ownNpub);
    return [...npubs].sort().join("|");
  }, [contacts, currentNpub]);

  const watchedNpubs = React.useMemo(
    () => (watchedNpubsKey ? watchedNpubsKey.split("|") : []),
    [watchedNpubsKey],
  );

  React.useEffect(() => {
    if (!enabled) return;
    const pubkeys = watchedNpubs
      .map(decodeNpubToPubkey)
      .filter((pubkey): pubkey is Pubkey => pubkey !== null);
    setWatchedProfiles(pubkeys);
    return () => setWatchedProfiles([]);
  }, [enabled, setWatchedProfiles, watchedNpubs]);

  const contextRef = React.useRef(context);
  React.useEffect(() => {
    contextRef.current = context;
  });

  React.useEffect(() => {
    if (!enabled) return;
    // One handler object per session: swapping the handler reopens the relay
    // subscriptions, so per-render context is reached through a ref.
    setProfileWatchHandler({
      onEvent: (event) => applyProfileWatchEvent(event, contextRef.current),
    });
    return () => setProfileWatchHandler(null);
  }, [enabled, setProfileWatchHandler]);

  // Reconcile contact rows against the cached profiles: watch events fire
  // only for strictly newer facts, so a row that fell out of step with an
  // already-cached profile (new contact, or a sync-policy change) would
  // otherwise stay stale until the peer republishes. Writes only on diffs.
  React.useEffect(() => {
    for (const npub of watchedNpubs) {
      const cachedProfile = loadCachedProfile(npub);
      if (!cachedProfile) continue;
      syncContactsFromProfile(
        npub,
        cachedProfile.metadata,
        cachedProfile.metadata,
        contextRef.current,
      );
    }
  }, [watchedNpubs]);

  React.useEffect(() => {
    let cancelled = false;

    for (const npub of watchedNpubs) {
      const cachedProfile = loadCachedProfile(npub);
      if (cachedProfile) {
        const metadata = cachedProfile.metadata;
        setNostrMetadataByNpub((prev) =>
          prev[npub] ? prev : { ...prev, [npub]: metadata },
        );
        const url = getProfilePictureUrl(metadata);
        setNostrPictureByNpub((prev) =>
          npub in prev ? prev : { ...prev, [npub]: url },
        );
        if (url) {
          void loadCachedProfileAvatarObjectUrl(npub).then((blobUrl) => {
            if (cancelled || !blobUrl) return;
            setNostrPictureByNpub((prev) =>
              prev[npub] === url ? { ...prev, [npub]: blobUrl } : prev,
            );
          });
        }
      }

      const cachedStatus = loadCachedStatus(npub);
      if (cachedStatus) {
        setNostrStatusByNpub((prev) =>
          npub in prev
            ? prev
            : { ...prev, [npub]: cachedStatus.content || null },
        );
      }
    }

    return () => {
      cancelled = true;
    };
  }, [
    setNostrMetadataByNpub,
    setNostrPictureByNpub,
    setNostrStatusByNpub,
    watchedNpubs,
  ]);
};
