import type { ProfileMetadata } from "@linky-fit/linkstr";
import {
  fetchProfileAtom,
  publishProfileAtom,
  useAtomSet,
} from "@linky-fit/linkstr-react";
import { Exit } from "effect";
import React from "react";
import { reportAppLog } from "../../../devtools/inspector/appLog";
import { useDeferredOnlineReady } from "../../../hooks/useDeferredOnlineReady";
import { saveCachedProfile } from "../../../profileCache";
import { nowSeconds } from "../../../utils/time";
import { dropNpubNip05 } from "../../lib/profileMetadata";
import { fetchAndCacheProfile } from "../useLinkstrProfileSync";

interface UseNpubNip05CleanupParams {
  currentNpub: string | null;
  enabled: boolean;
  setMyProfileMetadata: React.Dispatch<
    React.SetStateAction<ProfileMetadata | null>
  >;
}

/**
 * Once per session, republishes the own profile without the
 * `npub…@linky.fit` nip05 older versions published, which linky.fit never
 * verifies. A failed attempt retries on the next start.
 */
export const useNpubNip05Cleanup = ({
  currentNpub,
  enabled,
  setMyProfileMetadata,
}: UseNpubNip05CleanupParams) => {
  const onlineReady = useDeferredOnlineReady();
  const fetchProfile = useAtomSet(fetchProfileAtom, { mode: "promiseExit" });
  const publishProfile = useAtomSet(publishProfileAtom, {
    mode: "promiseExit",
  });
  const attemptedRef = React.useRef(false);

  React.useEffect(() => {
    if (!enabled || !onlineReady || !currentNpub) return;
    if (attemptedRef.current) return;
    attemptedRef.current = true;

    void (async () => {
      // Fetched from relays, so a newer profile from another device is never replaced.
      const newest = await fetchAndCacheProfile(fetchProfile, currentNpub);
      const cleaned = newest ? dropNpubNip05(newest) : null;
      if (!newest || !cleaned) return;

      const publishExit = await publishProfile(cleaned);
      if (Exit.isFailure(publishExit)) return;

      saveCachedProfile(currentNpub, cleaned, nowSeconds());
      setMyProfileMetadata(cleaned);
      reportAppLog({
        tag: "profile.npubNip05Dropped",
        summary: `Republished own profile without nip05 ${newest.nip05}`,
        links: { wrap: [publishExit.value.eventId] },
        payload: { droppedNip05: newest.nip05 },
      });
    })();
  }, [
    currentNpub,
    enabled,
    fetchProfile,
    onlineReady,
    publishProfile,
    setMyProfileMetadata,
  ]);
};
