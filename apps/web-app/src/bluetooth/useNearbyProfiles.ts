import {
  createFetchProfilesAtom,
  linkstrConfigAtom,
  useAtomSet,
  useAtomValue,
} from "@linky/linkstr-react";
import React from "react";
import { fetchAndCacheProfiles } from "../app/hooks/useLinkstrProfileSync";
import { getContactPublicProfile } from "../app/lib/contactProfile";
import { omitSyntheticContactLightningAddress } from "../derivedProfile";
import { getProfilePictureUrl, loadCachedProfile } from "../profileCache";

export const useNearbyProfiles = (
  npubs: readonly string[],
  enabled: boolean,
) => {
  const config = useAtomValue(linkstrConfigAtom);
  const [fetchProfilesAtom] = React.useState(createFetchProfilesAtom);
  const fetchProfiles = useAtomSet(fetchProfilesAtom, { mode: "promiseExit" });
  const attempted = React.useRef(new Set<string>());
  const visibleNpubs = React.useRef(new Set<string>());
  const fetchQueue = React.useRef(Promise.resolve());
  const mounted = React.useRef(false);
  const [, refresh] = React.useReducer((revision: number) => revision + 1, 0);
  const [onlineRevision, retryOnline] = React.useReducer(
    (revision: number) => revision + 1,
    0,
  );
  const npubsKey = enabled ? [...new Set(npubs)].sort().join("|") : "";
  const canFetch = (config?.readRelays.length ?? 0) > 0;

  React.useEffect(() => {
    mounted.current = true;
    const onOnline = () => {
      attempted.current.clear();
      retryOnline();
    };
    window.addEventListener("online", onOnline);
    return () => {
      mounted.current = false;
      window.removeEventListener("online", onOnline);
    };
  }, []);

  React.useEffect(() => {
    visibleNpubs.current = new Set(npubsKey ? npubsKey.split("|") : []);
  }, [npubsKey]);

  React.useEffect(() => {
    if (!canFetch || !npubsKey) return;
    const pending = npubsKey
      .split("|")
      .filter((npub) => !attempted.current.has(npub));
    if (pending.length === 0) return;
    pending.forEach((npub) => attempted.current.add(npub));
    fetchQueue.current = fetchQueue.current
      .then(async () => {
        if (!mounted.current) return;
        const current = pending.filter((npub) => {
          if (visibleNpubs.current.has(npub)) return true;
          attempted.current.delete(npub);
          return false;
        });
        if (current.length === 0) return;
        try {
          await fetchAndCacheProfiles(fetchProfiles, current);
        } finally {
          if (mounted.current) refresh();
        }
      })
      .catch(() => undefined);
  }, [canFetch, fetchProfiles, npubsKey, onlineRevision]);

  return (npubsKey ? npubsKey.split("|") : []).map((npub) => {
    const metadata = loadCachedProfile(npub)?.metadata;
    const profile = getContactPublicProfile(npub, metadata);
    return {
      npub,
      name: profile.name,
      lnAddress: omitSyntheticContactLightningAddress(profile.lnAddress, npub),
      pictureUrl: getProfilePictureUrl(metadata),
    };
  });
};
