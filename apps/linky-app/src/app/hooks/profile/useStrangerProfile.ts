import type { ProfileMetadata } from "@linky-fit/linkstr";
import { useLinkstrCommands } from "@linky-fit/linkstr-react";
import React from "react";
import { getProfilePictureUrl, loadCachedProfile } from "../../../profileCache";
import { getBestNostrName } from "../../../utils/formatting";
import { fetchAndCacheProfile } from "../useLinkstrProfileSync";

/** The public name and photo of someone who is not a contact, from the profile cache or fetched once; null until known or while `enabled` is false. */
export const useStrangerProfile = (
  npub: string,
  enabled: boolean,
): { name: string | null; pictureUrl: string | null } | null => {
  const { fetchProfile } = useLinkstrCommands();
  const [profile, setProfile] = React.useState<{
    npub: string;
    name: string | null;
    pictureUrl: string | null;
  } | null>(null);
  React.useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const apply = (metadata: ProfileMetadata | null) => {
      if (cancelled || !metadata) return;
      setProfile({
        npub,
        name: getBestNostrName(metadata),
        pictureUrl: getProfilePictureUrl(metadata),
      });
    };
    const cached = loadCachedProfile(npub);
    if (cached) apply(cached.metadata);
    else void fetchAndCacheProfile(fetchProfile, npub).then(apply);
    return () => {
      cancelled = true;
    };
  }, [enabled, fetchProfile, npub]);
  return enabled && profile?.npub === npub ? profile : null;
};
