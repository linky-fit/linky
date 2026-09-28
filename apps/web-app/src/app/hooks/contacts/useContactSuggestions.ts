import {
  encodeNpub,
  type DiscoverActiveProfilesOptions,
  type DiscoveredProfile,
  type ProfileMetadata,
} from "@linky-fit/linkstr";
import {
  discoverActiveProfilesAtom,
  linkstrConfigAtom,
  useAtomSet,
  useAtomValue,
} from "@linky-fit/linkstr-react";
import { Exit } from "effect";
import React from "react";
import { omitSyntheticContactLightningAddress } from "../../../derivedProfile";
import { getProfilePictureUrl } from "../../../profileCache";
import { formatShortNpub, getBestNostrName } from "../../../utils/formatting";

const CONTACT_SUGGESTION_LIMIT = 3;
const CONTACT_SUGGESTION_WINDOW_SECONDS = 60 * 60;
const LINKY_LIGHTNING_ADDRESS_SUFFIX = "@linky.fit";
const STATUS_EVENT_KIND = 30315;

// Public relays' kind-1 firehose saturates the default activity scan within
// hours, drowning out linky users entirely; statuses are the event kind linky
// itself publishes, so scanning only those actually surfaces linky users. The
// section is "new Linky users", so only the last hour counts.
const CONTACT_SUGGESTION_DISCOVERY: DiscoverActiveProfilesOptions = {
  activeWindowSeconds: CONTACT_SUGGESTION_WINDOW_SECONDS,
  activityKinds: [STATUS_EVENT_KIND],
  authorScanLimit: 200,
};

export interface ContactSuggestionCandidate {
  lnAddress: string;
  name: string;
  npub: string;
  pictureUrl: string | null;
  query: string;
  displayLnAddress: string;
}

const getProfileLightningAddress = (metadata: ProfileMetadata): string =>
  (metadata.lud16 ?? "").trim() || (metadata.lud06 ?? "").trim();

const isLinkyUser = (metadata: ProfileMetadata): boolean =>
  getProfileLightningAddress(metadata)
    .toLowerCase()
    .endsWith(LINKY_LIGHTNING_ADDRESS_SUFFIX);

export const selectContactSuggestions = (
  profiles: ReadonlyArray<DiscoveredProfile>,
  knownNpubs: ReadonlySet<string>,
): ContactSuggestionCandidate[] => {
  const suggestions: ContactSuggestionCandidate[] = [];

  for (const profile of profiles) {
    if (suggestions.length >= CONTACT_SUGGESTION_LIMIT) break;

    const npub = encodeNpub(profile.pubkey);
    if (knownNpubs.has(npub)) continue;
    if (!isLinkyUser(profile.metadata)) continue;

    // A fresh account only has the synthetic npub@linky.fit address, which
    // is hidden in the UI; the profile still counts as a Linky user.
    const displayLnAddress = getProfileLightningAddress(profile.metadata);
    const lnAddress = omitSyntheticContactLightningAddress(
      displayLnAddress,
      npub,
    );
    suggestions.push({
      displayLnAddress,
      lnAddress,
      name:
        getBestNostrName(profile.metadata) ??
        (lnAddress || formatShortNpub(npub)),
      npub,
      pictureUrl: getProfilePictureUrl(profile.metadata),
      query: lnAddress || npub,
    });
  }

  return suggestions;
};

export const useContactSuggestions = (
  enabled: boolean,
  knownNpubsKey: string,
): ContactSuggestionCandidate[] => {
  const [suggestions, setSuggestions] = React.useState<
    ContactSuggestionCandidate[]
  >([]);
  const linkstrConfig = useAtomValue(linkstrConfigAtom);
  const discoverActiveProfiles = useAtomSet(discoverActiveProfilesAtom, {
    mode: "promiseExit",
  });
  const canDiscover = (linkstrConfig?.readRelays.length ?? 0) > 0;

  React.useEffect(() => {
    if (!enabled || !canDiscover) {
      setSuggestions((current) => (current.length === 0 ? current : []));
      return;
    }

    const knownNpubs = new Set(knownNpubsKey ? knownNpubsKey.split("\n") : []);
    let cancelled = false;

    const load = async () => {
      const exit = await discoverActiveProfiles(CONTACT_SUGGESTION_DISCOVERY);
      if (cancelled) return;

      setSuggestions(
        Exit.isSuccess(exit)
          ? selectContactSuggestions(exit.value, knownNpubs)
          : [],
      );
    };

    void load().catch(() => {
      if (!cancelled) setSuggestions([]);
    });

    return () => {
      cancelled = true;
    };
  }, [canDiscover, discoverActiveProfiles, enabled, knownNpubsKey]);

  return suggestions;
};
