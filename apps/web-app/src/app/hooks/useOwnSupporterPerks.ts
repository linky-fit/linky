import type { SupporterAwardRecord } from "@linky-fit/linksync";
import { useLiveValue } from "@linky-fit/linksync/react";
import type { SupporterBadgeKind } from "@linky-fit/ui";
import React from "react";
import { setUnlockedSupporterTier } from "../../utils/themePalette";
import { useEveryMinute } from "../../hooks/useEveryMinute";
import { supporterValiditySeconds } from "../lib/supporter";
import {
  publishedSupporterBadge,
  supporterAwardStamps,
  unlockedSupporterTier,
} from "../lib/supporterPerks";
import {
  useSupporterAwardRecords,
  useSupporterAwardsRepository,
} from "./useLinksync";
import { useSupporterBadgeDisplay } from "./useSupporterBadgeDisplay";

/** The badge contacts see on the own avatar: what the display setting publishes; awards lapse without a reload. */
export const useOwnSupporterBadge = (): SupporterBadgeKind | undefined => {
  const records = useSupporterAwardRecords();
  const { display } = useSupporterBadgeDisplay();
  const awards = React.useMemo(() => supporterAwardStamps(records), [records]);
  return useEveryMinute(
    (nowSec) =>
      publishedSupporterBadge(
        awards,
        display,
        nowSec,
        supporterValiditySeconds,
      ) ?? undefined,
  );
};

/** Unlocks the palettes of the own awards' tier; mount once in the authenticated shell. */
export const useSupporterThemeUnlock = (): void => {
  const records = useLiveValue<ReadonlyArray<SupporterAwardRecord> | null>(
    useSupporterAwardsRepository(),
    null,
  );
  const awards = React.useMemo(
    () => (records ? supporterAwardStamps(records) : null),
    [records],
  );
  const tier = useEveryMinute((nowSec) =>
    awards
      ? unlockedSupporterTier(awards, nowSec, supporterValiditySeconds)
      : undefined,
  );
  React.useEffect(() => {
    if (tier !== undefined) setUnlockedSupporterTier(tier);
  }, [tier]);
};
