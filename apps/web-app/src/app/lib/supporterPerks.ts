import { SupporterBadgeType } from "@linky-fit/linkstr";
import type { SettingValues, SupporterAwardRecord } from "@linky-fit/linksync";
import {
  compareSupporterTiers,
  isSupporterAwardValid,
  type SupporterTier,
} from "@linky-fit/supporter";
import { Schema } from "effect";

/** What the perks need from a verified award: which badge and when it started. */
export interface SupporterAwardStamp {
  readonly badge: SupporterBadgeType;
  readonly awardedAt: number;
}

const isTier = (badge: SupporterBadgeType): badge is SupporterTier =>
  badge !== "generic";

const isBadgeType = Schema.is(SupporterBadgeType);

const validBadges = (
  awards: ReadonlyArray<SupporterAwardStamp>,
  nowSec: number,
  validitySeconds: number | undefined,
): ReadonlyArray<SupporterBadgeType> =>
  awards
    .filter(({ awardedAt }) =>
      isSupporterAwardValid(awardedAt, nowSec, validitySeconds),
    )
    .map(({ badge }) => badge);

const highestTier = (
  badges: ReadonlyArray<SupporterBadgeType>,
): SupporterTier | null =>
  badges
    .filter(isTier)
    .reduce<SupporterTier | null>(
      (best, tier) =>
        best === null || compareSupporterTiers(tier, best) > 0 ? tier : best,
      null,
    );

export const supporterAwardStamps = (
  records: ReadonlyArray<SupporterAwardRecord>,
): ReadonlyArray<SupporterAwardStamp> =>
  records.flatMap(({ badge, awardedAtSec }) =>
    isBadgeType(badge) ? [{ badge, awardedAt: awardedAtSec }] : [],
  );

/** The badge a contact shows: the highest valid tier, else generic when one is valid. */
export const shownSupporterBadge = (
  awards: ReadonlyArray<SupporterAwardStamp>,
  nowSec: number,
  validitySeconds?: number,
): SupporterBadgeType | null => {
  const badges = validBadges(awards, nowSec, validitySeconds);
  return highestTier(badges) ?? (badges.includes("generic") ? "generic" : null);
};

/** The highest valid tier, whose palettes and every lower one are unlocked. */
export const unlockedSupporterTier = (
  awards: ReadonlyArray<SupporterAwardStamp>,
  nowSec: number,
  validitySeconds?: number,
): SupporterTier | null =>
  highestTier(validBadges(awards, nowSec, validitySeconds));

/** The badge the display setting publishes, the newest valid one of its kind, as `profileBadgeAward` picks it. */
export const publishedSupporterBadge = (
  awards: ReadonlyArray<SupporterAwardStamp>,
  display: SettingValues["supporterBadgeDisplay"],
  nowSec: number,
  validitySeconds?: number,
): SupporterBadgeType | null => {
  if (display === "hide") return null;
  const newest = awards
    .filter(
      ({ awardedAt, badge }) =>
        (badge === "generic") === (display === "generic") &&
        isSupporterAwardValid(awardedAt, nowSec, validitySeconds),
    )
    .reduce<SupporterAwardStamp | null>(
      (best, award) =>
        best === null || award.awardedAt > best.awardedAt ? award : best,
      null,
    );
  return newest?.badge ?? null;
};
